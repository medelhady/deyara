-- One-off: labels the owners who registered before an offer set the role.
--
-- Every number that writes to the bot is created as a renter, and the role was only ever changed by
-- publishing a listing -- which collection mode never does. So the dashboard read "0 مؤجر" beside a
-- demand page showing seven, and the one number a decision rests on was the wrong one.
--
-- Safe to run more than once.

-- 1. Preview: who will be relabelled, and what they offered.
select
  u.phone,
  u.role as role_now,
  count(c.id) as offers
from users u
join collection_entries c on c.phone = u.phone and c.side = 'owner'
where u.role is distinct from 'owner'
group by u.phone, u.role;

-- 2. Apply
update users
set role = 'owner'
where phone in (select distinct phone from collection_entries where side = 'owner')
  and role is distinct from 'owner';
