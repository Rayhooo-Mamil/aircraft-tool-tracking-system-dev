-- First create a PRIVATE bucket named "tool-images" in Supabase Storage.
-- Set its maximum file size to 3.5 MB (3,670,016 bytes).
-- Then run this in Supabase SQL Editor. Only active Admin users can manage/view photos.

drop policy if exists "Admins can view tool images" on storage.objects;
create policy "Admins can view tool images"
on storage.objects
for select
to authenticated
using (bucket_id = 'tool-images' and public.is_admin());

drop policy if exists "Admins can upload tool images" on storage.objects;
create policy "Admins can upload tool images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'tool-images' and public.is_admin());

drop policy if exists "Admins can delete tool images" on storage.objects;
create policy "Admins can delete tool images"
on storage.objects
for delete
to authenticated
using (bucket_id = 'tool-images' and public.is_admin());
