-- Qualify the outer storage key: workspace_products also has a name column.
alter policy "club image read" on storage.objects
using (
  bucket_id = 'club-images' and public.current_role() is not null and (
    split_part(storage.objects.name, '/', 1) = (select auth.uid())::text
    or public.is_staff()
    or exists (
      select 1 from public.workspace_products p
      where '/api/images/' || storage.objects.name = p.image
         or '/api/images/' || storage.objects.name = any(p.views)
    )
    or exists (
      select 1 from public.workspace_donations d
      where '/api/images/' || storage.objects.name = any(string_to_array(d.image, '|'))
    )
  )
);
