-- The marketer walkthrough, and a way to turn it off.
--
-- Every message inside it calls the language model, so an open demo is a running cost. "off" stops
-- the entry word being recognised; anything else leaves it on.
--
-- Safe to run more than once.
alter table app_settings
  add column if not exists demo_enabled text default 'on';
