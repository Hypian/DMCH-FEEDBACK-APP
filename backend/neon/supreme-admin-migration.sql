-- Grants a separate user-management permission only to explicitly selected admins.
create table if not exists public.feedback_supreme_admins (
  user_id text primary key references public.feedback_admins(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Bootstrap a Supreme Admin if none exists yet by promoting the earliest admin:
insert into public.feedback_supreme_admins (user_id)
select user_id from public.feedback_admins
order by created_at asc
limit 1
on conflict (user_id) do nothing;

