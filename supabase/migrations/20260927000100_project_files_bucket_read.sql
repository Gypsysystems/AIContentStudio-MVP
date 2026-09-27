-- Cloud project readiness needs private project-files bucket metadata, not object access.
drop policy if exists project_files_bucket_read_member on storage.buckets;
create policy project_files_bucket_read_member on storage.buckets
  for select to authenticated using (
    id = 'project-files'
    and exists (
      select 1 from public.workspace_memberships membership
      where membership.user_id = (select auth.uid())
    )
  );
