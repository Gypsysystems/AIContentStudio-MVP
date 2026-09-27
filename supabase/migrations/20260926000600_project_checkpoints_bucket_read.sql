-- Readiness needs private bucket metadata, not access to checkpoint objects.
drop policy if exists project_checkpoints_bucket_read_member on storage.buckets;
create policy project_checkpoints_bucket_read_member on storage.buckets
  for select to authenticated using (
    id = 'project-checkpoints'
    and exists (
      select 1 from public.workspace_memberships membership
      where membership.user_id = (select auth.uid())
    )
  );