-- Run this once in Supabase SQL Editor before saving a tool photo.
-- Tool photos are stored as small compressed image data directly on the tool record.
alter table public.tools
  add column if not exists image_url text;
