insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('elite-subscriber-pdfs','elite-subscriber-pdfs',false,10485760,array['application/pdf'])
on conflict(id) do nothing;
create policy elite_subscriber_pdfs_read on storage.objects for select to authenticated
using (bucket_id='elite-subscriber-pdfs' and (
 elite_private.is_admin() or exists (
 select 1 from public.elite_resources r
 join public.elite_subscriptions s on s.plan_level >= r.required_level
 join public.elite_members m on m.id=s.member_id
 where m.auth_user_id=(select auth.uid())
 and s.status='active'
 and s.start_date <= (now() at time zone 'America/Sao_Paulo')::date
 and s.end_date >= (now() at time zone 'America/Sao_Paulo')::date
 and r.active and r.resource_type='pdf'
 and r.url='storage://elite-subscriber-pdfs/'||storage.objects.name
 )));
create policy elite_subscriber_pdfs_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='elite-subscriber-pdfs' and elite_private.is_admin());
create policy elite_subscriber_pdfs_admin_update on storage.objects for update to authenticated
using(bucket_id='elite-subscriber-pdfs' and elite_private.is_admin())
with check(bucket_id='elite-subscriber-pdfs' and elite_private.is_admin());
create policy elite_subscriber_pdfs_admin_delete on storage.objects for delete to authenticated
using(bucket_id='elite-subscriber-pdfs' and elite_private.is_admin());
