-- Records every WhatsApp message the system sends on its own, and whether it arrived.
--
-- Sends are fire-and-forget by design: a failed notification must not break the flow that triggered
-- it. That also made every failure invisible, since the only trace was a console line nobody reads.
-- The most common failure needs no code fix at all -- WhatsApp refuses free-form text to anyone who
-- has not written in the last 24 hours -- but you cannot decide that without seeing it.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.notification_log (
  id uuid primary key default uuid_generate_v4(),
  -- Deliberately not a foreign key into users: admin alert numbers are staff, not bot users.
  phone text not null,
  kind text not null,
  body text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_log_created_at_idx on public.notification_log(created_at desc);
create index if not exists notification_log_status_idx on public.notification_log(status);
create index if not exists notification_log_phone_idx on public.notification_log(phone);

alter table public.notification_log enable row level security;
