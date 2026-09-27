begin;
do $$
declare u uuid:=gen_random_uuid(); later_u uuid:=gen_random_uuid(); p public.elite_plans%rowtype; oid uuid; later_order uuid; uid uuid; n int; finish date;
begin
 select * into p from public.elite_plans where name='Elite Starter';
 insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(u,'manual-test-'||u||'@example.invalid','{}','{}');
 insert into public.elite_orders(redemption_code,item_type,item_id,item_name,amount,customer_name,customer_email,customer_phone,status,redemption_message,privacy_consent_at,terms_consent_at)
 values('TEST-'||u,'plan',p.id,p.name,p.price_monthly,'Teste pagamento',' MANUAL-TEST-'||upper(u::text)||'@EXAMPLE.INVALID ','31999999999','novo','Test',now(),now()) returning id into oid;
 update public.elite_orders set status='concluido' where id=oid;
 select m.auth_user_id,s.end_date into uid,finish from public.elite_subscriptions s join public.elite_members m on m.id=s.member_id where s.source_order_id=oid;
 if uid is distinct from u then raise exception 'Existing account not linked'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 select count(*) into n from storage.objects where bucket_id='elite-subscriber-pdfs';
 reset role;
 if n<>10 then raise exception 'Manual subscriber cannot read all PDFs: %',n; end if;
 update public.elite_subscriptions set vod_used=1 where source_order_id=oid;
 update public.elite_orders set status='concluido' where id=oid;
 if (select count(*) from public.elite_subscriptions where source_order_id=oid)<>1 then raise exception 'Duplicate subscription'; end if;
 if not exists(select 1 from public.elite_subscriptions where source_order_id=oid and vod_used=1 and end_date=finish) then raise exception 'Repeated confirmation changed paid period or usage'; end if;
 insert into public.elite_orders(redemption_code,item_type,item_id,item_name,amount,customer_name,customer_email,customer_phone,status,redemption_message,privacy_consent_at,terms_consent_at)
 values('TEST-'||later_u,'plan',p.id,p.name,p.price_monthly,'Teste cadastro posterior','manual-later-'||later_u||'@example.invalid','31999999999','concluido','Test',now(),now()) returning id into later_order;
 insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(later_u,'manual-later-'||later_u||'@example.invalid','{}','{}');
 select m.auth_user_id into uid from public.elite_subscriptions s join public.elite_members m on m.id=s.member_id where s.source_order_id=later_order;
 if uid is distinct from later_u then raise exception 'Signup after payment not linked'; end if;
 perform set_config('request.jwt.claim.sub',later_u::text,true);
 set local role authenticated;
 select count(*) into n from storage.objects where bucket_id='elite-subscriber-pdfs';
 reset role;
 if n<>10 then raise exception 'Later signup cannot read PDFs'; end if;
end $$;
rollback;
select 'PASS: manual confirmation, email normalization, 10 PDFs, duplicate confirmation, signup after payment' as result;
