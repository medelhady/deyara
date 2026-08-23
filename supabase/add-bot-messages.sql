-- Lets an admin reword the bot's marketing messages without a deploy.
--
-- Only the messages whose wording is a business decision live here. Anything whose text is tangled
-- with its logic -- search results, error messages, the owner contact card -- stays in code.
--
-- An empty or missing row means "use the text shipped in the code", so a message can never end up
-- blank, and clearing the field is how you reset one.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.bot_messages (
  key text primary key,
  body text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.bot_messages enable row level security;
