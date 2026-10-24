create table if not exists public.feedback_departments (
  id text primary key,
  labels jsonb not null check (jsonb_typeof(labels) = 'array' and jsonb_array_length(labels) = 3),
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  language text not null check (language in ('en', 'fr', 'rw')),
  department_id text not null,
  department_name text not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  is_demo boolean not null default false,
  user_id text references public."user"(id) on delete set null
);

create table if not exists public.feedback_admins (
  user_id text primary key references public."user"(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_supreme_admins (
  user_id text primary key references public.feedback_admins(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_account_approvals (
  user_id text primary key references public."user"(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'deactivated')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public."user"(id) on delete set null
);

create table if not exists public.device_submissions (
  device_hash text primary key,
  submitted_at timestamptz not null
);

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

create table if not exists public.feedback_session_activity (
  session_token text primary key,
  user_id text not null references public."user"(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

create index if not exists feedback_responses_submitted_at_idx
  on public.feedback_responses (submitted_at desc);
create index if not exists feedback_responses_department_id_idx
  on public.feedback_responses (department_id);
create index if not exists feedback_responses_user_id_idx
  on public.feedback_responses (user_id);
create index if not exists feedback_account_approvals_pending_idx
  on public.feedback_account_approvals (created_at)
  where status = 'pending';
create index if not exists feedback_audit_events_created_at_idx
  on public.feedback_audit_events (created_at desc);
create index if not exists feedback_audit_events_actor_user_id_idx
  on public.feedback_audit_events (actor_user_id, created_at desc);
create index if not exists feedback_audit_events_target_idx
  on public.feedback_audit_events (target_type, target_id);
create index if not exists feedback_session_activity_user_id_idx
  on public.feedback_session_activity (user_id);
create index if not exists feedback_session_activity_last_active_idx
  on public.feedback_session_activity (last_active_at desc);


insert into public.feedback_departments (id, labels, sort_order) values
  ('o0', '["Gynecology & Obs", "Gynécologie - Obstétrique", "Ubuvuzi bw’ababyeyi"]'::jsonb, 0),
  ('o1', '["Internal medicine", "Médecine interne", "Ubuvuzi bw’imbere mu Mubiri"]'::jsonb, 1),
  ('o2', '["Orthopedic", "Orthopédie", "Ubuvuzi bw’indwara z’amagufa"]'::jsonb, 2),
  ('o3', '["Pediatrics", "Pédiatrie", "Ubuvuzi bw''Abana"]'::jsonb, 3),
  ('o4', '["General surgery", "Chirurgie générale", "Imbagwa"]'::jsonb, 4),
  ('o5', '["Physiotherapy & rehabilitation", "Physiothérapie & Réeducation", "kugorora ingingo"]'::jsonb, 5),
  ('o6', '["General medicine", "Médecine générale", "Ubuvuzi Rusange"]'::jsonb, 6),
  ('o7', '["ENT", "ORL", "Ubuvuzi bw’indwara z’amatwi, Izuru n''Umuhogo"]'::jsonb, 7),
  ('o8', '["Urology", "Urologie", "Ubuvuzi bw’umuyoboro w''Inkari"]'::jsonb, 8),
  ('o9', '["Ophthalmology", "Ophtalmologie", "Ubuvuzi bw’amaso"]'::jsonb, 9),
  ('o10', '["Dental", "Dentaire", "Ubuvuzi bw’amenyo"]'::jsonb, 10),
  ('o11', '["Emergency & observation", "Urgences & Observation", "Aho bakirira indembe n’inkomere"]'::jsonb, 11),
  ('o12', '["Radiology /Imaging", "Radiologie/Imagerie", "Guca mu cyuma"]'::jsonb, 12),
  ('o13', '["Vaccination", "Vaccination", "Aho batangira Inkingo"]'::jsonb, 13),
  ('o14', '["Laboratory", "Laboratoire", "Aho batangira ibizamini"]'::jsonb, 14),
  ('o15', '["Minor surgery", "Petite chirurgie", "Kubagwa Byoroheje"]'::jsonb, 15)
on conflict (id) do nothing;


-- After Sandra signs up, promote the account once using the Better Auth user
-- ID (never a shared default password):
-- insert into public.feedback_admins (user_id) values ('BETTER_AUTH_USER_ID');

-- Keep Neon Data API access disabled for these tables. The Node backend uses
-- parameterized SQL, session checks, and feedback_admins authorization.
