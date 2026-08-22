-- Dashboard logins: a phone number and a password per person, instead of one shared admin key.
-- Run this once in the Supabase SQL editor.
--
-- These are staff accounts for the web dashboard. They are deliberately separate from public.users,
-- which holds every phone number that has ever talked to the bot.
--
-- No password ever reaches this table in the clear: password_hash holds a PBKDF2-SHA256 digest
-- written by the app.

create table if not exists public.dashboard_accounts (
  id uuid primary key default uuid_generate_v4(),
  phone text not null unique,
  name text not null default '',
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  last_login_at timestamptz
);

create index if not exists dashboard_accounts_phone_idx on public.dashboard_accounts(phone);

-- The table is reached only through the service role key, which bypasses RLS. Enabling it anyway
-- means the anon key cannot read password hashes if the table is ever exposed by mistake.
alter table public.dashboard_accounts enable row level security;
