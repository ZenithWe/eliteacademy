-- A paid future billing period must not expose resources before it starts.
alter policy elite_resources_select on public.elite_resources to authenticated
using (
 elite_private.is_admin() or (
  active and exists (
   select 1 from public.elite_subscriptions s
   join public.elite_members m on m.id=s.member_id
   where m.auth_user_id=(select auth.uid()) and s.status='active'
   and s.start_date <= (now() at time zone 'America/Sao_Paulo')::date
   and s.end_date >= (now() at time zone 'America/Sao_Paulo')::date
   and s.plan_level >= elite_resources.required_level
  )
 )
);
