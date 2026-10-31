-- Migration: WhatsApp Alert Contacts and Outbox Tables
-- Tracks staff alert recipients, E.164 phone numbers, department routing, and reliable outbox alerting.

create table if not exists public.staff_alert_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_e164 text not null,
  department_id text references public.feedback_departments(id) on delete set null,
  department_name text,
  role text not null default 'staff',
  is_duty_manager boolean not null default false,
  alert_enabled boolean not null default true,
  min_severity text not null default 'normal' check (min_severity in ('normal', 'high', 'critical')),
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_contacts_dept
  on public.staff_alert_contacts (department_id, alert_enabled);

create index if not exists idx_staff_contacts_duty_mgr
  on public.staff_alert_contacts (is_duty_manager, alert_enabled);

create table if not exists public.alert_outbox (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_responses(id) on delete cascade,
  recipient_id uuid references public.staff_alert_contacts(id) on delete set null,
  recipient_phone text not null,
  recipient_name text,
  department_id text,
  department_name text,
  severity text not null check (severity in ('normal', 'high', 'critical')),
  reason text not null,
  detected_language text not null default 'en',
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'acknowledged', 'escalated')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz not null default now(),
  last_error text,
  provider text not null default 'whatsapp',
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  escalated_at timestamptz,
  constraint uq_alert_outbox_feedback_recipient unique (feedback_id, recipient_id)
);

create index if not exists idx_alert_outbox_status_retry
  on public.alert_outbox (status, next_retry_at)
  where status in ('pending', 'sent', 'delivered', 'read');

create index if not exists idx_alert_outbox_feedback
  on public.alert_outbox (feedback_id);

create index if not exists idx_alert_outbox_provider_msg
  on public.alert_outbox (provider_message_id)
  where provider_message_id is not null;

