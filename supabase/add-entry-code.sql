-- A short number for every request, the one both sides can say out loud.
--
-- "طلب 128" is what a person quotes on the phone and what an admin searches to find their row in
-- one go -- across WhatsApp, a call and the Excel sheet it means the same thing. A uuid cannot be
-- read down a phone line, and "the renter from لكصر with three rooms" matches four rows.
--
-- Given by the database rather than by the app: two people registering in the same second would
-- otherwise be handed the same number, and a reference that repeats is worse than none.
--
-- Starts at 101 so the first request does not look like a test, and carries on past 999 on its own.
--
-- Safe to run more than once.
create sequence if not exists collection_entry_code_seq start 101;

alter table collection_entries
  add column if not exists code integer;

-- The rows collected before today, numbered in the order they arrived.
with ordered as (
  select id, row_number() over (order by created_at) + 100 as number
  from collection_entries
  where code is null
)
update collection_entries entry
set code = ordered.number
from ordered
where entry.id = ordered.id;

-- The sequence carries on from the highest number already handed out.
select setval('collection_entry_code_seq', (select coalesce(max(code), 100) + 1 from collection_entries), false);

alter table collection_entries
  alter column code set default nextval('collection_entry_code_seq');

create unique index if not exists collection_entries_code_idx on collection_entries (code);
