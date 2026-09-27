-- Execute inside BEGIN/ROLLBACK. Never commits fixtures or sends a payment.
do $$
declare u uuid:=gen_random_uuid(); c uuid; plan public.elite_plans%rowtype;
 counter integer; owner_id uuid; first_order uuid;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,aud,role)
 values(u,'mp-test-'||u||'@example.invalid',now(),'{}','{}','authenticated','authenticated');
 select * into strict plan from public.elite_plans where name='Elite Pro';
 insert into public.elite_mp_checkouts(user_id,plan_id,plan_name,amount,plan_level,vod_quota,
 coach_quota,live_coach_quota,customer_name,customer_email,customer_phone,consent_version)
 values(u,plan.id,plan.name,plan.price_monthly,plan.plan_level,plan.vod_quota,plan.coach_quota,
 plan.live_coach_quota,'Teste integração','mp-test-'||u||'@example.invalid','31999999999','test') returning id into c;
 perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','pending',35,'BRL','2026-09-27T15:00Z','2026-09-27T15:00Z');
 select count(*) into counter from public.elite_mp_payments where checkout_id=c and order_id is not null;
 if counter<>0 then raise exception 'Pending payment granted access'; end if;
 begin
   perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','approved',1,'BRL','2026-09-27T15:00Z','2026-09-27T15:01Z');
   raise exception 'Wrong amount accepted';
 exception when raise_exception then
   if sqlerrm='Wrong amount accepted' then raise; end if;
 end;
 perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','approved',35,'BRL','2026-09-27T15:00Z','2026-09-27T15:01Z');
 select order_id into first_order from public.elite_mp_payments where checkout_id=c;
 select m.auth_user_id into owner_id from public.elite_subscriptions s join public.elite_members m on m.id=s.member_id where s.source_order_id=first_order;
 if owner_id is distinct from u then raise exception 'Wrong account'; end if;
 if not exists(select 1 from public.elite_subscriptions where source_order_id=first_order and start_date='2026-09-27' and end_date='2026-10-26' and vod_total=2 and coach_total=1 and status='active') then raise exception 'Wrong period or quota'; end if;
 update public.elite_subscriptions set vod_used=1 where source_order_id=first_order;
 perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','approved',35,'BRL','2026-09-27T15:00Z','2026-09-27T15:01Z');
 if not exists(select 1 from public.elite_subscriptions where source_order_id=first_order and vod_used=1) then raise exception 'Duplicate reset quota'; end if;
 perform public.elite_mp_apply_payment(c,'test-invoice-2','test-payment-2','approved',35,'BRL','2026-10-27T15:00Z','2026-10-27T15:01Z');
 select count(*) into counter from public.elite_mp_payments where checkout_id=c and order_id is not null;
 if counter<>2 then raise exception 'Renewal missing'; end if;
 perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','refunded',35,'BRL','2026-09-27T15:00Z','2026-10-28T15:01Z');
 if not exists(select 1 from public.elite_subscriptions where source_order_id=first_order and status='cancelled') then raise exception 'Refund not revoked'; end if;
 perform public.elite_mp_apply_payment(c,'test-invoice-1','test-payment-1','approved',35,'BRL','2026-09-27T15:00Z','2026-09-27T15:01Z');
 if not exists(select 1 from public.elite_subscriptions where source_order_id=first_order and status='cancelled') then raise exception 'Old notification restored refunded payment'; end if;
 if has_function_privilege('authenticated','public.elite_mp_apply_payment(uuid,text,text,text,numeric,text,timestamptz,timestamptz)','EXECUTE') then raise exception 'Public payment write allowed'; end if;
 if has_table_privilege('authenticated','public.elite_mp_checkouts','INSERT') then raise exception 'Public checkout insert allowed'; end if;
end $$;
