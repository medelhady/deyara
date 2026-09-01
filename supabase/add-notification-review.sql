-- Lets an admin close the "N إشعار لم يصل" banner once they have looked at the failures.
--
-- Without it the banner counts every failure of the last 24 hours and there is no way to say "seen":
-- a fault you have already diagnosed and fixed keeps warning you for a day, which teaches you to
-- ignore the banner -- and the next real failure is ignored with it.
--
-- Safe to run more than once.
alter table notification_log
  add column if not exists reviewed_at timestamptz;

comment on column notification_log.reviewed_at is
  'When an admin marked this failure as seen. Reviewed rows stop counting towards the dashboard alert.';

create index if not exists notification_log_unreviewed_idx
  on notification_log (created_at)
  where status = 'failed' and reviewed_at is null;
