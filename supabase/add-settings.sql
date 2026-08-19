-- Values that used to be constants in the code or environment variables, so they can be changed
-- from the admin dashboard without a redeploy.
-- Run this once. Missing rows fall back to the defaults baked into src/lib/settings.ts.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('contact_reveal_points', '1'),
  ('listing_fee_points', '2000'),
  ('referral_commission_percent', '30'),
  ('minimum_withdrawal_points', '500'),
  ('points_payment_number', ''),
  ('admin_notify_numbers', '')
on conflict (key) do nothing;
