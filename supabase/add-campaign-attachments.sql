-- A campaign can answer with more than a video.
--
-- What explains the work best is not always the same file: a voice note in the dialect people
-- actually speak reaches someone who will not watch two minutes of video, a picture of the price
-- list answers the only question a merchant has, and a PDF is what an office asks for. Holding one
-- video column forced every campaign into one shape.
--
-- Each entry is {"type": "video|image|audio|document", "path": "...", "name": "..."} and they are
-- sent in the order they were added, before the text.
--
-- Safe to run more than once.
alter table bot_campaigns
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- The video already attached to a campaign becomes its first attachment, so nothing that works
-- today stops working.
update bot_campaigns
set attachments = jsonb_build_array(jsonb_build_object('type', 'video', 'path', video_path))
where video_path is not null
  and (attachments is null or attachments = '[]'::jsonb);

comment on column bot_campaigns.attachments is
  'Files sent before the reply text, in order: video, image, audio (voice note) or document.';
