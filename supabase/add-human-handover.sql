-- Hands one conversation to a person, and keeps the bot out of it.
--
-- The moment an admin answers from the dashboard, the bot is still running: the reply the user
-- writes back is read as an answer to a form, so someone mid-sentence with a human is asked "في أي
-- مقاطعة؟" or told "طلبك مسجّل عندنا" -- the bot talking over the person who just spoke.
--
-- human_until is when the bot may speak again. human_ack_at is when the user was told, once, that a
-- person has their message, so silence is not mistaken for nobody being there.
--
-- Kept on the person rather than the conversation state: the state is rewritten whole at several
-- points in the flow, and a handover erased by an unrelated save is a bot that interrupts anyway.
--
-- Safe to run more than once.
alter table users
  add column if not exists human_until timestamptz,
  add column if not exists human_ack_at timestamptz;

comment on column users.human_until is
  'While this is in the future the bot stays silent -- an admin is answering this number by hand.';

comment on column users.human_ack_at is
  'When the user was told once that a person has their message. Cleared when a new handover starts.';

create index if not exists users_human_until_idx on users (human_until);
