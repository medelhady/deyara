create table if not exists public.user_wallets (
  phone text primary key references public.users(phone) on delete cascade,
  usage_points integer not null default 0 check (usage_points >= 0),
  commission_points integer not null default 0 check (commission_points >= 0),
  withdrawn_commission_points integer not null default 0 check (withdrawn_commission_points >= 0),
  referral_code text unique,
  referred_by_phone text references public.users(phone),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_wallets_no_self_referral check (referred_by_phone is null or referred_by_phone <> phone)
);

create table if not exists public.credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  phone text not null references public.users(phone) on delete cascade,
  kind text not null check (kind in ('topup', 'topup_approved', 'contact_reveal', 'property_listing', 'referral_commission', 'withdrawal', 'admin_adjustment')),
  usage_points_delta integer not null default 0,
  commission_points_delta integer not null default 0,
  related_phone text references public.users(phone),
  related_contact_request_id uuid references public.contact_requests(id) on delete set null,
  admin_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default uuid_generate_v4(),
  phone text not null references public.users(phone) on delete cascade,
  points integer not null check (points > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  payout_note text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_topups (
  id uuid primary key default uuid_generate_v4(),
  phone text not null references public.users(phone) on delete cascade,
  points integer,
  receipt_image_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_wallets_referral_code_idx on public.user_wallets(referral_code);
create index if not exists user_wallets_referred_by_phone_idx on public.user_wallets(referred_by_phone);
create index if not exists credit_transactions_phone_created_idx on public.credit_transactions(phone, created_at desc);
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests(status);
create index if not exists credit_topups_status_idx on public.credit_topups(status);

alter table public.user_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.credit_topups enable row level security;

drop trigger if exists user_wallets_set_updated_at on public.user_wallets;
create trigger user_wallets_set_updated_at
before update on public.user_wallets
for each row execute function public.set_updated_at();

drop trigger if exists withdrawal_requests_set_updated_at on public.withdrawal_requests;
create trigger withdrawal_requests_set_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

drop trigger if exists credit_topups_set_updated_at on public.credit_topups;
create trigger credit_topups_set_updated_at
before update on public.credit_topups
for each row execute function public.set_updated_at();
