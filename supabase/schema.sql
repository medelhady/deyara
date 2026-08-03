create extension if not exists "uuid-ossp";

create type user_role as enum ('renter', 'owner', 'admin');
create type property_status as enum ('draft', 'pending_review', 'active', 'rejected', 'hidden', 'rented');
create type media_type as enum ('image', 'video');
create type contact_request_status as enum ('pending_payment', 'pending_admin_review', 'approved', 'rejected', 'expired');
create type payment_status as enum ('pending', 'approved', 'rejected');
create type conversation_direction as enum ('inbound', 'outbound');

create table public.users (
  id uuid primary key default uuid_generate_v4(),
  phone text not null unique,
  name text,
  role user_role not null default 'renter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default uuid_generate_v4(),
  property_code text unique,
  owner_phone text not null references public.users(phone),
  type text,
  area text,
  neighborhood text,
  landmark text,
  price numeric,
  rooms integer,
  description text,
  latitude numeric,
  longitude numeric,
  status property_status not null default 'draft',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.property_code_seq start with 1 increment by 1;

create or replace function public.next_property_code()
returns text
language plpgsql
as $$
begin
  return lpad(nextval('public.property_code_seq')::text, 4, '0');
end;
$$;

alter table public.properties
alter column property_code set default public.next_property_code();

create table public.property_media (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  type media_type not null,
  storage_url text not null,
  content_type text,
  created_at timestamptz not null default now()
);

create table public.search_requests (
  id uuid primary key default uuid_generate_v4(),
  renter_phone text not null references public.users(phone),
  raw_message text not null,
  property_type text,
  area text,
  max_price numeric,
  rooms integer,
  created_at timestamptz not null default now()
);

create table public.contact_requests (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id),
  renter_phone text not null references public.users(phone),
  owner_phone text not null references public.users(phone),
  status contact_request_status not null default 'pending_payment',
  renter_share_allowed boolean not null default false,
  fee_amount numeric,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default uuid_generate_v4(),
  contact_request_id uuid not null references public.contact_requests(id) on delete cascade,
  receipt_image_url text,
  status payment_status not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  direction conversation_direction not null,
  message_type text not null,
  body text,
  whatsapp_message_id text,
  provider text not null default 'twilio',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.conversation_states (
  phone text primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  kind text not null default 'area',
  aliases text[] not null default '{}',
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now()
);

create index properties_status_area_price_idx on public.properties(status, area, price);
create index properties_property_code_idx on public.properties(property_code);
create index contact_requests_status_idx on public.contact_requests(status);
create index conversations_phone_created_idx on public.conversations(phone, created_at desc);
create index conversation_states_updated_at_idx on public.conversation_states(updated_at desc);
create index places_kind_name_idx on public.places(kind, name);

alter table public.users enable row level security;
alter table public.properties enable row level security;
alter table public.property_media enable row level security;
alter table public.search_requests enable row level security;
alter table public.contact_requests enable row level security;
alter table public.payments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_states enable row level security;
alter table public.places enable row level security;

-- The app backend uses SUPABASE_SERVICE_ROLE_KEY. Admin-facing RLS policies can be added
-- when Supabase Auth roles for dashboard users are finalized.
