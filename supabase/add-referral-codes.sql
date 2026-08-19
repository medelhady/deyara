-- Referral codes used to be the marketer's own phone number plus its last four digits, so the number
-- travelled inside every invite message they forwarded. Codes are four random characters now, minted
-- on first use, and unrelated to the phone.
--
-- This clears every existing code. Links already shared with those codes stop working, which is the
-- intended trade: none had been handed out yet.
--
-- referred_at records when a referral was registered, so the commission window can be measured from
-- the day the referred person joined rather than from their first top-up.

alter table public.user_wallets
  add column if not exists referred_at timestamptz;

-- Existing referrals predate the column; their wallet row was created when they joined.
update public.user_wallets
set referred_at = created_at
where referred_by_phone is not null
  and referred_at is null;

update public.user_wallets
set referral_code = null;

insert into public.app_settings (key, value) values
  ('bot_whatsapp_number', ''),
  ('referral_window_months', '12')
on conflict (key) do nothing;
