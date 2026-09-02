-- The office commission moves from a global setting to the listing itself.
--
-- It was one amount per district, chosen by the admin. But the commission is an arrangement between
-- the owner and their office, and it differs house by house -- so the owner is asked for it while
-- listing, and it is stored here.
--
-- Null means the question was never asked: listings published before this change keep showing no
-- commission line rather than a wrong one.
--
-- Safe to run more than once.
alter table properties
  add column if not exists office_commission integer;

comment on column properties.office_commission is
  'What the renter pays the office for this house, set by the owner while listing. 0 means none; null means not asked.';
