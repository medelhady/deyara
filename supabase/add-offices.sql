-- The agencies, read off screenshots.
--
-- The offices are not on the bot and will not be for a while: they are on Facebook and TikTok, as a
-- name and a number inside a post. Typing those out one by one is the work that never gets done, so
-- a screenshot goes in and a row comes out, and the list becomes something to call from.
--
-- phones is a list because an office publishes two or three numbers, and calling the one that does
-- not answer is not the same as having no number.
--
-- Safe to run more than once.
create table if not exists real_estate_offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phones jsonb not null default '[]'::jsonb,
  -- Where the screenshot came from: فيسبوك، تيك توك، واتساب… Kept because how you reach an office
  -- depends on where it lives.
  platform text,
  note text,
  -- The screenshot itself, in the property-media bucket, so a doubtful row can be checked against
  -- the picture it was read from.
  screenshot_path text,
  created_at timestamptz not null default now()
);

create index if not exists real_estate_offices_created_idx on real_estate_offices (created_at desc);
