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

create index if not exists bot_dictionary_category_active_idx
on public.bot_dictionary(category, active);

alter table public.bot_dictionary enable row level security;

alter table public.bot_dictionary
add column if not exists response_text text;

drop trigger if exists bot_dictionary_set_updated_at on public.bot_dictionary;
create trigger bot_dictionary_set_updated_at
before update on public.bot_dictionary
for each row execute function public.set_updated_at();
