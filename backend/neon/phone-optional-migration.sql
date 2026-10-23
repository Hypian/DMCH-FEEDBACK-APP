-- Phone is no longer collected during signup. Preserve existing phone values,
-- but allow Better Auth to create users without writing to this legacy column.
alter table public."user"
  alter column phone drop not null;
  