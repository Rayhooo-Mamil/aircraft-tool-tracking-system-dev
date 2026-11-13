-- Run this once in Supabase SQL Editor before saving a tool photo.
-- The image_url column stores a private Supabase Storage object path for new photos.
-- Existing data-URI values continue to display until migrated by an Admin in the app.
alter table public.tools
  add column if not exists image_url text;
