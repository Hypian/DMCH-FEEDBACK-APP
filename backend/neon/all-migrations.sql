-- ==============================================================================
-- DMCH Patient Feedback - Complete Consolidated Database Migration
-- Safe & idempotent: can be executed on new or existing Neon Postgres databases.
-- ==============================================================================

-- 1. Ensure phone column in user table is optional (phone no longer collected during signup)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user'
      and column_name = 'phone'
  ) then
    alter table public."user" alter column phone drop not null;
  end if;
end $$;

-- 2. Supreme Admins role table
create table if not exists public.feedback_supreme_admins (
  user_id text primary key references public.feedback_admins(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3. Append-only Application Audit Events table
create table if not exists public.feedback_audit_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_user_id text,
  action text not null,
  summary text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists feedback_audit_events_created_at_idx
  on public.feedback_audit_events (created_at desc);

create index if not exists feedback_audit_events_actor_user_id_idx
  on public.feedback_audit_events (actor_user_id, created_at desc);

-- 4. Update feedback_account_approvals constraint to support 'deactivated'
alter table public.feedback_account_approvals
  drop constraint if exists feedback_account_approvals_status_check;

alter table public.feedback_account_approvals
  add constraint feedback_account_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'deactivated'));

create index if not exists feedback_account_approvals_pending_idx
  on public.feedback_account_approvals (created_at)
  where status = 'pending';
