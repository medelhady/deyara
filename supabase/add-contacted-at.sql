-- Marks the people already spoken to.
--
-- With four hundred numbers and seven offers, the question that decides the day is not "who is
-- there" but "who have I not called yet". Without this the list is re-read from the top each time
-- and the same person is contacted twice while another is never reached at all.
--
-- Kept on the person rather than the entry: someone who registered twice was contacted once.
--
-- Safe to run more than once.
alter table users
  add column if not exists contacted_at timestamptz;

comment on column users.contacted_at is
  'When an admin last reached this person -- set automatically by a dashboard reply, or by hand for a call made elsewhere.';

create index if not exists users_contacted_idx on users (contacted_at);
