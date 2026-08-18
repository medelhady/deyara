-- The app writes two transaction kinds the original CHECK constraint never allowed, so those ledger
-- rows were rejected and the wallet history was incomplete:
--   property_listing  — the fee charged when an admin publishes a listing
--   topup_approved    — points credited after an admin approves a transfer receipt
-- Run this once against an existing database. all-in-one.sql already includes the wider list.

alter table public.credit_transactions
  drop constraint if exists credit_transactions_kind_check;

alter table public.credit_transactions
  add constraint credit_transactions_kind_check check (
    kind in (
      'topup',
      'topup_approved',
      'contact_reveal',
      'property_listing',
      'referral_commission',
      'withdrawal',
      'admin_adjustment'
    )
  );
