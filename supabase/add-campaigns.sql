-- Ready answers for the people the bot was never built for.
--
-- A marketer, a merchant or a partner who writes in is not renting a house and not listing one, so
-- every path in the bot is wrong for them. What they need is one explanation -- usually a video the
-- admin already has -- sent the moment they write the word from the advert.
--
-- Kept as rows rather than in the code so an advert can go out today and its answer can exist five
-- minutes later, without a deploy.
--
-- Safe to run more than once.
create table if not exists bot_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- What this is for, in plain words: "إعلان التجار", "شراكة المسوقين".
  name text not null,
  -- The words that trigger it, comma separated. Matched loosely: spelling, diacritics and أ/ا do not
  -- have to be right, because the person is copying a word out of an advert.
  keywords text not null default '',
  reply_text text not null default '',
  -- A file in the property-media bucket. The video is the answer; the text goes with it.
  video_path text,
  active boolean not null default true,
  -- How many people this actually reached, which is the only honest measure of an advert.
  hits integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_campaigns_active_idx on bot_campaigns (active);
