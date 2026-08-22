-- Retires the two contact request statuses left over from before points.
--
-- Back then a renter asked for a number, paid by transfer, and waited for an admin to approve the
-- request. Points replaced that: a request is created already approved, and admin approval only
-- credits points. Nothing has produced 'pending_payment' or 'pending_admin_review' since.
--
-- Run this once in the Supabase SQL editor. The first statement reports how many rows were still
-- carrying an old status; on most databases this will be zero.

-- 1. Look before changing anything.
select status, count(*) as rows
from public.contact_requests
where status in ('pending_payment', 'pending_admin_review')
group by status;

-- 2. Close them. 'expired' and not 'approved': these renters never received a number, and marking
--    them approved would record a delivery that never happened. A renter who asks again simply
--    makes a fresh request and pays the current point price.
update public.contact_requests
set status = 'expired'
where status in ('pending_payment', 'pending_admin_review');

-- 3. Stop the table handing out a legacy status by default. The application always states the
--    status it means, so dropping the default makes any future insert that forgets fail loudly
--    instead of quietly writing a status nothing handles.
alter table public.contact_requests
  alter column status drop default;

-- The enum still lists both values. Removing a value from a Postgres enum means rebuilding the type
-- and rewriting the column, which is a real risk on a live table for no functional gain: an unused
-- value costs nothing and no code path can write one any more.
