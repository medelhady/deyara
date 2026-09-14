-- Marks one request as read and written down.
--
-- Three hundred rows, read a few at a time between other work: without a mark the eye starts from
-- the top every session, and the ones already copied out are read again while the ones below are
-- never reached.
--
-- Kept on the entry, not the person: someone who registered a house and a search is two requests to
-- read, and marking one must not silence the other. Being contacted is a different thing entirely,
-- and lives on the person.
--
-- Safe to run more than once.
alter table collection_entries
  add column if not exists handled_at timestamptz;

comment on column collection_entries.handled_at is
  'When an admin finished reading this request and took its details. Set from the heart on the demand page.';

create index if not exists collection_entries_handled_idx on collection_entries (handled_at);
