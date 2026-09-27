-- Personal verification records are accessible only from authenticated server code.
create table if not exists public.elite_buyer_verifications (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text,
 phone_verified_at timestamptz,
 phone_line_type text,
 challenge_phone text,
 challenge_sid text,
 challenge_expires_at timestamptz,
 cpf_fingerprint text,
 cpf_last4 text,
 cpf_registry_verified_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.elite_buyer_verifications enable row level security;
revoke all on public.elite_buyer_verifications from public,anon,authenticated;
grant all on public.elite_buyer_verifications to service_role;

create table if not exists public.elite_identity_attempts (
 id bigint generated always as identity primary key,
 subject text not null,
 created_at timestamptz not null default now()
);
create index if not exists elite_identity_attempts_subject_time on public.elite_identity_attempts(subject,created_at);
alter table public.elite_identity_attempts enable row level security;
revoke all on public.elite_identity_attempts from public,anon,authenticated;
grant all on public.elite_identity_attempts to service_role;
grant usage,select on sequence public.elite_identity_attempts_id_seq to service_role;

create or replace function public.elite_identity_take_attempt(p_subject text,p_limit integer,p_window_seconds integer,p_cooldown_seconds integer default 0)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; latest timestamptz;
begin
 if p_limit<1 or p_window_seconds<1 or length(p_subject)>200 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subject,0));
 select count(*),max(created_at) into n,latest from public.elite_identity_attempts
 where subject=p_subject and created_at>now()-make_interval(secs=>p_window_seconds);
 if n>=p_limit or latest>now()-make_interval(secs=>p_cooldown_seconds) then return false; end if;
 insert into public.elite_identity_attempts(subject) values(p_subject);
 delete from public.elite_identity_attempts where subject=p_subject and created_at<now()-interval '30 days';
 return true;
end $$;
revoke all on function public.elite_identity_take_attempt(text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.elite_identity_take_attempt(text,integer,integer,integer) to service_role;

alter table public.elite_orders add column if not exists buyer_user_id uuid references auth.users(id) on delete set null;
alter table public.elite_orders add column if not exists customer_cpf_last4 text;
alter table public.elite_orders add column if not exists identity_level text;
alter table public.elite_mp_checkouts add column if not exists customer_cpf_last4 text;
alter table public.elite_mp_checkouts add column if not exists identity_level text;

-- Run only after the identity endpoint and frontend have been deployed:
-- drop policy if exists elite_orders_public_insert on public.elite_orders;
-- create policy elite_orders_admin_insert on public.elite_orders for insert to authenticated
-- with check(elite_private.is_admin());
