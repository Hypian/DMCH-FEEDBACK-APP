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

comment on table public.feedback_audit_events is
  'Append-only application audit events visible to authorized admins.';
