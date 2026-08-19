-- Lets an admin stop a number from using the bot (spam, fraud attempts) and lift it later.
-- Run this once. Nothing else is needed: a null blocked_at means the user is active.

alter table public.users
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;

create index if not exists users_blocked_at_idx on public.users(blocked_at);
