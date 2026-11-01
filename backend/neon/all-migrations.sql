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

create index if not exists feedback_audit_events_target_idx
  on public.feedback_audit_events (target_type, target_id);

-- 4. Update feedback_account_approvals constraint to support 'deactivated'
alter table public.feedback_account_approvals
  drop constraint if exists feedback_account_approvals_status_check;

alter table public.feedback_account_approvals
  add constraint feedback_account_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'deactivated'));

create index if not exists feedback_account_approvals_pending_idx
  on public.feedback_account_approvals (created_at)
  where status = 'pending';

-- 5. Safe Supreme Admin bootstrap: if feedback_supreme_admins is empty, promote the earliest admin
insert into public.feedback_supreme_admins (user_id)
select user_id from public.feedback_admins
order by created_at asc
limit 1
on conflict (user_id) do nothing;

-- 6. Session Inactivity Tracking table for 1-hour backend inactivity timeout
create table if not exists public.feedback_session_activity (
  session_token text primary key,
  user_id text not null references public."user"(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

create index if not exists feedback_session_activity_user_id_idx
  on public.feedback_session_activity (user_id);

create index if not exists feedback_session_activity_last_active_idx
  on public.feedback_session_activity (last_active_at desc);

-- 7. Sentiment and Urgency Analysis columns & indexes on feedback_responses
alter table public.feedback_responses
  add column if not exists sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  add column if not exists urgent boolean not null default false,
  add column if not exists urgent_reason text,
  add column if not exists urgent_signals jsonb not null default '[]'::jsonb,
  add column if not exists analysis_source text check (analysis_source in ('llm', 'fallback')),
  add column if not exists detected_language text check (detected_language in ('en', 'fr', 'rw', 'other')),
  add column if not exists target_category text check (target_category in ('clinical', 'public_relations', 'managing_director'));

create index if not exists feedback_responses_urgent_idx
  on public.feedback_responses (urgent)
  where urgent = true;

create index if not exists feedback_responses_sentiment_idx
  on public.feedback_responses (sentiment);

create index if not exists idx_feedback_responses_target_category
  on public.feedback_responses (target_category);




-- 8. WhatsApp / Twilio / Email Staff Alert Contacts and Outbox Tables
create table if not exists public.staff_alert_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_e164 text not null,
  department_id text references public.feedback_departments(id) on delete set null,
  department_name text,
  role text not null default 'staff',
  is_duty_manager boolean not null default false,
  alert_enabled boolean not null default true,
  email text,
  sms_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_opt_in_at timestamptz default now(),
  email_opt_in_at timestamptz default now(),
  target_category text not null default 'clinical' check (target_category in ('clinical', 'public_relations', 'managing_director', 'all')),
  min_severity text not null default 'normal' check (min_severity in ('normal', 'high', 'critical')),
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_contacts_dept
  on public.staff_alert_contacts (department_id, alert_enabled);

create index if not exists idx_staff_contacts_duty_mgr
  on public.staff_alert_contacts (is_duty_manager, alert_enabled);

create index if not exists idx_staff_contacts_target_category
  on public.staff_alert_contacts (target_category, alert_enabled);

create index if not exists idx_staff_contacts_email
  on public.staff_alert_contacts (email)
  where email is not null;

create table if not exists public.alert_outbox (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_responses(id) on delete cascade,
  recipient_id uuid references public.staff_alert_contacts(id) on delete set null,
  recipient_phone text not null,
  recipient_email text,
  recipient_name text,
  department_id text,
  department_name text,
  severity text not null check (severity in ('normal', 'high', 'critical')),
  target_category text not null default 'clinical' check (target_category in ('clinical', 'public_relations', 'managing_director', 'all')),
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  reason text not null,
  detected_language text not null default 'en',
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'acknowledged', 'escalated')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz not null default now(),
  last_error text,
  provider text not null default 'twilio',
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  escalated_at timestamptz,
  constraint uq_alert_outbox_feedback_recipient unique (feedback_id, recipient_id, channel)
);

alter table public.alert_outbox
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_alert_outbox_status_retry
  on public.alert_outbox (status, next_retry_at)
  where status in ('pending', 'sent', 'delivered', 'read');

create index if not exists idx_alert_outbox_channel
  on public.alert_outbox (channel, status);

create index if not exists idx_alert_outbox_target_category
  on public.alert_outbox (target_category, status);

create index if not exists idx_alert_outbox_feedback
  on public.alert_outbox (feedback_id);

create index if not exists idx_alert_outbox_provider_msg
  on public.alert_outbox (provider_message_id)
  where provider_message_id is not null;

-- 9. User Username, Phone & Category Link for Staff Alert Routing
alter table public."user"
  add column if not exists username text;

create unique index if not exists user_username_unique
  on public."user" (username);

alter table public."user"
  add column if not exists phone text;

alter table public."user"
  add column if not exists category text not null default 'clinical' check (category in ('clinical', 'public_relations', 'managing_director'));

alter table public.staff_alert_contacts
  add column if not exists user_id text;

alter table public.staff_alert_contacts
  drop constraint if exists uq_staff_contacts_user_id;

alter table public.staff_alert_contacts
  add constraint uq_staff_contacts_user_id unique (user_id);

