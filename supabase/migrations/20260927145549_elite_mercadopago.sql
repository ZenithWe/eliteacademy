-- Additive installation for the existing Elite Academy schema.
begin;
create table public.elite_mp_checkouts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 plan_id uuid not null references public.elite_plans(id),
 plan_name text not null, amount numeric(12,2) not null check(amount > 0),
 plan_level integer not null, vod_quota integer not null,
 coach_quota integer not null, live_coach_quota integer not null,
 customer_name text not null, customer_email text not null, customer_phone text not null,
 preapproval_id text unique, checkout_url text,
 status text not null default 'creating' check(status in ('creating','pending','authorized','paused','cancelled')),
 provider_updated_at timestamptz,
 consent_version text not null, consent_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create unique index elite_mp_one_open_checkout on public.elite_mp_checkouts(user_id)
 where status in ('creating','pending','authorized','paused');
create index elite_mp_checkouts_plan on public.elite_mp_checkouts(plan_id);
alter table public.elite_mp_checkouts enable row level security;
revoke all on public.elite_mp_checkouts from anon,authenticated;
grant select on public.elite_mp_checkouts to authenticated;
grant all on public.elite_mp_checkouts to service_role;
create policy elite_mp_checkout_read on public.elite_mp_checkouts for select to authenticated
 using (user_id=(select auth.uid()) or elite_private.is_admin());

create table public.elite_mp_payments (
 invoice_id text primary key, payment_id text unique not null,
 checkout_id uuid not null references public.elite_mp_checkouts(id),
 order_id uuid unique references public.elite_orders(id),
 status text not null, amount numeric(12,2) not null,
 provider_updated_at timestamptz not null,
 updated_at timestamptz not null default now()
);
create index elite_mp_payments_checkout on public.elite_mp_payments(checkout_id);
alter table public.elite_mp_payments enable row level security;
revoke all on public.elite_mp_payments from anon,authenticated;
grant select on public.elite_mp_payments to authenticated;
grant all on public.elite_mp_payments to service_role;
create policy elite_mp_payments_admin on public.elite_mp_payments for select to authenticated
 using (elite_private.is_admin());

-- Called only by the backend AFTER validating the signature and fetching the
-- invoice, subscription and payment directly from Mercado Pago.
-- Invoker security + EXECUTE restricted to service_role, not a public definer.
create function public.elite_mp_apply_payment(
 p_checkout_id uuid,p_invoice_id text,p_payment_id text,p_status text,
 p_amount numeric,p_currency text,p_period_start timestamptz,p_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c public.elite_mp_checkouts%rowtype;
 previous public.elite_mp_payments%rowtype;
 member uuid; order_key uuid; period_start date; period_end date;
begin
 select * into strict c from public.elite_mp_checkouts where id=p_checkout_id for update;
 if p_currency<>'BRL' or p_amount<>c.amount or p_updated_at is null then
   raise exception 'Invalid payment currency, amount or timestamp';
 end if;
 if p_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation') then
   raise exception 'Unsupported payment status';
 end if;
 select * into previous from public.elite_mp_payments where invoice_id=p_invoice_id;
 if found and previous.checkout_id<>c.id then raise exception 'Invoice ownership mismatch'; end if;
 if previous.provider_updated_at is not null and p_updated_at<=previous.provider_updated_at then
   return jsonb_build_object('duplicate',true);
 end if;
 order_key:=previous.order_id;
 if p_status='approved' and order_key is null then
   if p_period_start is null then raise exception 'Missing billing period'; end if;
   period_start:=(p_period_start at time zone 'America/Sao_Paulo')::date;
   period_end:=(period_start+interval '1 month')::date-1;
   select id into member from public.elite_members where auth_user_id=c.user_id;
   if member is null then
     select id into member from public.elite_members
      where lower(email)=lower(c.customer_email) and auth_user_id is null limit 1 for update;
     if member is null then
       insert into public.elite_members(auth_user_id,full_name,email,phone)
       values(c.user_id,c.customer_name,c.customer_email,c.customer_phone) returning id into member;
     else
       update public.elite_members set auth_user_id=c.user_id where id=member;
     end if;
   end if;
   insert into public.elite_orders(redemption_code,item_type,item_id,item_name,item_variant,amount,
    customer_name,customer_email,customer_phone,status,redemption_message,privacy_consent_at,terms_consent_at,consent_version)
   values('MP-'||p_payment_id,'plan',c.plan_id,c.plan_name,'Assinatura mensal Mercado Pago',c.amount,
    c.customer_name,c.customer_email,c.customer_phone,'concluido','Pagamento confirmado automaticamente pelo Mercado Pago: '||p_payment_id,c.consent_at,c.consent_at,c.consent_version)
   returning id into order_key;
   -- Existing completion trigger creates the sale and subscription atomically.
   update public.elite_subscriptions set member_id=member,plan_level=c.plan_level,
     start_date=period_start,end_date=period_end,vod_total=c.vod_quota,
     coach_total=c.coach_quota,live_coach_total=c.live_coach_quota,
     notes='Mercado Pago: '||p_payment_id where source_order_id=order_key;
   update public.elite_sales set source='mercadopago',sale_date=p_period_start where order_id=order_key;
 elsif order_key is not null and p_status in ('refunded','charged_back','cancelled','in_mediation') then
   update public.elite_subscriptions set status='cancelled' where source_order_id=order_key;
   update public.elite_orders set status='cancelado' where id=order_key;
   update public.elite_sales set status=case when p_status='refunded' then 'refunded' else 'cancelled' end
    where order_id=order_key;
 elsif order_key is not null and p_status='approved' then
   -- A resolved dispute may restore the original paid period, never extend it.
   update public.elite_subscriptions set status='active' where source_order_id=order_key;
   update public.elite_sales set status='paid' where order_id=order_key;
 end if;
 insert into public.elite_mp_payments(invoice_id,payment_id,checkout_id,order_id,status,amount,provider_updated_at)
 values(p_invoice_id,p_payment_id,c.id,order_key,p_status,p_amount,p_updated_at)
 on conflict(invoice_id) do update set payment_id=excluded.payment_id,order_id=excluded.order_id,
  status=excluded.status,provider_updated_at=excluded.provider_updated_at,updated_at=now();
 return jsonb_build_object('processed',true,'order_id',order_key);
end;
$$;
revoke all on function public.elite_mp_apply_payment(uuid,text,text,text,numeric,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.elite_mp_apply_payment(uuid,text,text,text,numeric,text,timestamptz,timestamptz) to service_role;
commit;
