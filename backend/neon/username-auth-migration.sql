-- Safe to run if Better Auth already added the username field.
-- Existing users keep their account IDs and password hashes. Their username is
-- derived from the old email local part plus a stable suffix to avoid collisions.
alter table public."user"
  add column if not exists username text;

create unique index if not exists user_username_unique
  on public."user" (username);

with legacy_users as (
  select
    id,
    coalesce(
      nullif(
        left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_.]', '', 'g'), 19),
        ''
      ),
      'user'
    ) as username_prefix
  from public."user"
  where username is null or username = ''
)
update public."user" as auth_user
set username = legacy_users.username_prefix || '_' || left(md5(legacy_users.id), 10)
from legacy_users
where auth_user.id = legacy_users.id;
