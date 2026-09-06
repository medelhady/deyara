-- What the bot collects before there is a market to trade in.
--
-- With no listings, the full flow -- video, fees, admin approval, paying for a number -- is friction
-- that costs the first hundred users, who are the hardest to get. In collection mode the bot asks
-- three questions and writes the answer here, from owners and renters alike, so both sides
-- accumulate at once and the district column is what joins them.
--
-- Kept apart from `properties` on purpose: an entry here has no video, no fee and no approval, and
-- must never be searchable as a listing. When the mode is switched off nothing is lost -- the rows
-- stay, and they are the demand list to show an agency that has not signed up.
--
-- Safe to run more than once.
create table if not exists collection_entries (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  -- 'owner' offers a house, 'renter' wants one. The only two sides there are.
  side text not null check (side in ('owner', 'renter')),
  area text not null,
  -- Rent for an owner, the most a renter can pay. Null when they would not say.
  price integer,
  -- Rooms, features and the nearest landmark, in their own words.
  specs text,
  rooms integer,
  -- Set when an admin typed this in from a Facebook or TikTok comment rather than the bot.
  added_by_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists collection_entries_area_idx on collection_entries (area, side);
create index if not exists collection_entries_created_idx on collection_entries (created_at desc);

alter table app_settings
  add column if not exists collection_mode text default 'off';
