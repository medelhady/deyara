create extension if not exists "uuid-ossp";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('renter', 'owner', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'property_status') then
    create type public.property_status as enum ('draft', 'pending_review', 'active', 'rejected', 'hidden', 'rented');
  end if;

  if not exists (select 1 from pg_type where typname = 'media_type') then
    create type public.media_type as enum ('image', 'video');
  end if;

  if not exists (select 1 from pg_type where typname = 'contact_request_status') then
    create type public.contact_request_status as enum ('pending_payment', 'pending_admin_review', 'approved', 'rejected', 'expired');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'approved', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_direction') then
    create type public.conversation_direction as enum ('inbound', 'outbound');
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  phone text not null unique,
  name text,
  role public.user_role not null default 'renter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
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
  status public.property_status not null default 'draft',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.property_code_seq start with 1 increment by 1;

create or replace function public.next_property_code()
returns text
language plpgsql
as $$
begin
  return lpad(nextval('public.property_code_seq')::text, 4, '0');
end;
$$;

alter table public.properties
add column if not exists property_code text;

alter table public.properties
alter column property_code set default public.next_property_code();

update public.properties
set property_code = public.next_property_code()
where property_code is null;

create unique index if not exists properties_property_code_key
on public.properties(property_code);

create table if not exists public.property_media (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  type public.media_type not null,
  storage_url text not null,
  content_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.search_requests (
  id uuid primary key default uuid_generate_v4(),
  renter_phone text not null references public.users(phone),
  raw_message text not null,
  property_type text,
  area text,
  max_price numeric,
  rooms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_requests (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id),
  renter_phone text not null references public.users(phone),
  owner_phone text not null references public.users(phone),
  status public.contact_request_status not null default 'pending_payment',
  renter_share_allowed boolean not null default false,
  fee_amount numeric,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  contact_request_id uuid not null references public.contact_requests(id) on delete cascade,
  receipt_image_url text,
  status public.payment_status not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  direction public.conversation_direction not null,
  message_type text not null,
  body text,
  whatsapp_message_id text,
  provider text not null default 'twilio',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_states (
  phone text primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  kind text not null default 'area',
  aliases text[] not null default '{}',
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_dictionary (
  id uuid primary key default uuid_generate_v4(),
  category text not null check (category in ('greeting', 'intro', 'renter_search', 'owner_listing', 'area')),
  phrase text not null,
  normalized_phrase text generated always as (lower(trim(phrase))) stored,
  response_text text,
  active boolean not null default true,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, normalized_phrase)
);

alter table public.bot_dictionary
add column if not exists response_text text;

create index if not exists properties_status_area_price_idx on public.properties(status, area, price);
create index if not exists properties_property_code_idx on public.properties(property_code);
create index if not exists properties_owner_phone_idx on public.properties(owner_phone);
create index if not exists property_media_property_id_idx on public.property_media(property_id);
create index if not exists contact_requests_status_idx on public.contact_requests(status);
create index if not exists contact_requests_renter_phone_idx on public.contact_requests(renter_phone);
create index if not exists conversations_phone_created_idx on public.conversations(phone, created_at desc);
create index if not exists conversation_states_updated_at_idx on public.conversation_states(updated_at desc);
create index if not exists places_kind_name_idx on public.places(kind, name);
create index if not exists bot_dictionary_category_active_idx on public.bot_dictionary(category, active);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

drop trigger if exists contact_requests_set_updated_at on public.contact_requests;
create trigger contact_requests_set_updated_at
before update on public.contact_requests
for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists conversation_states_set_updated_at on public.conversation_states;
create trigger conversation_states_set_updated_at
before update on public.conversation_states
for each row execute function public.set_updated_at();

drop trigger if exists bot_dictionary_set_updated_at on public.bot_dictionary;
create trigger bot_dictionary_set_updated_at
before update on public.bot_dictionary
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.properties enable row level security;
alter table public.property_media enable row level security;
alter table public.search_requests enable row level security;
alter table public.contact_requests enable row level security;
alter table public.payments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_states enable row level security;
alter table public.places enable row level security;
alter table public.bot_dictionary enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-media',
  'property-media',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.places (name, kind, aliases)
values
  ('تفرغ زينة', 'area', array['تفرغ زينه', 'tevragh zeina', 'tevreg zeina']),
  ('عرفات', 'area', array['arafat']),
  ('لكصر', 'area', array['ksar', 'لكصر']),
  ('تيارت', 'area', array['teyarett', 'تيارت']),
  ('دار النعيم', 'area', array['dar naim', 'دار النعيم']),
  ('السبخة', 'area', array['sebha', 'السبخة']),
  ('الميناء', 'area', array['mina', 'الميناء'])
on conflict do nothing;

-- Important:
-- The Next.js backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY in the browser.
-- Public user-facing access should go through API routes only.
