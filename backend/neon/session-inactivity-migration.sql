-- ==============================================================================
-- DMCH Patient Feedback - Session Inactivity Tracking Migration
-- Enforces a 1-hour backend inactivity timeout across all active user sessions.
-- ==============================================================================

create table if not exists public.feedback_session_activity (
  session_token text primary key,
  user_id text not null references public."user"(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

create index if not exists feedback_session_activity_user_id_idx
  on public.feedback_session_activity (user_id);

create index if not exists feedback_session_activity_last_active_idx
  on public.feedback_session_activity (last_active_at desc);
