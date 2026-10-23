-- Allows 'deactivated' status in feedback_account_approvals check constraint.
-- Enables Supreme Admins to deactivate and reactivate user accounts safely.
alter table public.feedback_account_approvals
  drop constraint if exists feedback_account_approvals_status_check;

alter table public.feedback_account_approvals
  add constraint feedback_account_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'deactivated'));
