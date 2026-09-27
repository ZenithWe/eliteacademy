-- Manual confirmation creates access atomically; repeated confirmation never renews it.
create or replace function elite_private.sync_completed_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 v_member_id uuid; v_user_id uuid; v_plan public.elite_plans%rowtype;
 v_email text:=lower(btrim(new.customer_email));
 v_day date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if new.status<>'concluido' then return new; end if;
 -- Never restore a refunded/cancelled sale by replaying a completion.
 if exists(select 1 from public.elite_sales where order_id=new.id and status in ('refunded','cancelled')) then return new; end if;
 if new.item_type='plan' then
  if coalesce(v_email,'')='' then raise exception 'Informe o e-mail do cliente antes de confirmar o plano.'; end if;
  select * into v_plan from public.elite_plans where id=new.item_id;
  if not found then select * into v_plan from public.elite_plans where name=new.item_name order by created_at limit 1; end if;
  if v_plan.id is null then raise exception 'Plano não encontrado. Confira o pedido antes de confirmar.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_email,0));
  select id into v_user_id from auth.users where lower(btrim(email))=v_email limit 1;
  if v_user_id is not null then
   select id into v_member_id from public.elite_members where auth_user_id=v_user_id;
  end if;
  if v_member_id is null then
   select id into v_member_id from public.elite_members
   where lower(btrim(email))=v_email and (auth_user_id is null or auth_user_id=v_user_id)
   order by created_at limit 1 for update;
  end if;
  if v_member_id is null then
   insert into public.elite_members(auth_user_id,full_name,email,phone)
   values(v_user_id,new.customer_name,v_email,new.customer_phone) returning id into v_member_id;
  elsif v_user_id is not null then
   update public.elite_members set auth_user_id=v_user_id where id=v_member_id and auth_user_id is null;
  end if;
 end if;
 insert into public.elite_sales(item_type,item_name,amount,customer_name,source,status,sale_date,notes,order_id)
 values(new.item_type,new.item_name,new.amount,new.customer_name,'pedido_site','paid',now(),
 'Venda criada ao concluir o pedido '||new.redemption_code,new.id)
 on conflict(order_id) do nothing;
 if new.item_type='plan' then
  insert into public.elite_subscriptions(member_id,customer_name,customer_email,plan_id,plan_name,plan_level,
  start_date,end_date,status,vod_total,coach_total,live_coach_total,renewal_amount,source_order_id,notes)
  values(v_member_id,new.customer_name,v_email,v_plan.id,v_plan.name,v_plan.plan_level,
  v_day,(v_day+interval '1 month')::date-1,'active',v_plan.vod_quota,v_plan.coach_quota,v_plan.live_coach_quota,
  new.amount,new.id,'Criada automaticamente ao confirmar o pedido '||new.redemption_code)
  on conflict(source_order_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function elite_private.sync_completed_order() from public,anon,authenticated;

