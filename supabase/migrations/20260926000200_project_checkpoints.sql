-- Immutable, workspace-scoped project snapshots backed by a private archive
-- bucket. Staging rows are deliberately separate from committed checkpoints.

create table if not exists public.cloud_project_checkpoint_stages (
  checkpoint_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  actor_user_id uuid not null references auth.users(id),
  parent_checkpoint_id uuid,
  reason text not null check (char_length(reason) between 1 and 200),
  expected_revision bigint not null check (expected_revision >= 0),
  expected_file_ids text[] not null default '{}',
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null,
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade,
  check (record->>'projectId' = project_id),
  check (record->>'workspaceId' = workspace_id::text)
);

create table if not exists public.cloud_project_checkpoints (
  checkpoint_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  project_id text not null,
  parent_checkpoint_id uuid,
  reason text not null check (char_length(reason) between 1 and 200),
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null,
  originating_record_revision bigint not null check (originating_record_revision >= 0),
  record_schema_version integer not null,
  record_digest text not null check (record_digest ~ '^[0-9a-f]{64}$'),
  integrity_digest text not null check (integrity_digest ~ '^[0-9a-f]{64}$'),
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  file_manifest jsonb not null check (jsonb_typeof(file_manifest) = 'array'),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete restrict,
  foreign key (parent_checkpoint_id)
    references public.cloud_project_checkpoints(checkpoint_id) on delete restrict,
  unique (workspace_id, project_id, checkpoint_id),
  check (record->>'projectId' = project_id),
  check (record->>'workspaceId' = workspace_id::text),
  check (record->>'recordRevision' = originating_record_revision::text),
  check (record->>'schemaVersion' = record_schema_version::text)
);
create index if not exists cloud_project_checkpoints_project_created
  on public.cloud_project_checkpoints (workspace_id, project_id, created_at desc, checkpoint_id desc);

create table if not exists public.cloud_project_checkpoint_file_stages (
  checkpoint_id uuid not null references public.cloud_project_checkpoint_stages(checkpoint_id) on delete cascade,
  workspace_id uuid not null,
  project_id text not null,
  file_id text not null check (char_length(file_id) between 1 and 256),
  name text not null check (char_length(name) between 1 and 512),
  type text not null,
  size bigint not null check (size >= 0 and size <= 104857600),
  uploaded_at bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  primary key (checkpoint_id, file_id),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade
);

create table if not exists public.cloud_project_checkpoint_files (
  checkpoint_id uuid not null references public.cloud_project_checkpoints(checkpoint_id) on delete restrict,
  workspace_id uuid not null,
  project_id text not null,
  file_id text not null,
  name text not null,
  type text not null,
  size bigint not null check (size >= 0 and size <= 104857600),
  uploaded_at bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  primary key (checkpoint_id, file_id),
  foreign key (workspace_id, project_id, checkpoint_id)
    references public.cloud_project_checkpoints(workspace_id, project_id, checkpoint_id) on delete restrict
);

alter table public.cloud_project_checkpoint_stages enable row level security;
alter table public.cloud_project_checkpoint_file_stages enable row level security;
alter table public.cloud_project_checkpoints enable row level security;
alter table public.cloud_project_checkpoint_files enable row level security;
revoke all on public.cloud_project_checkpoint_stages,
  public.cloud_project_checkpoint_file_stages,
  public.cloud_project_checkpoints,
  public.cloud_project_checkpoint_files from public, anon, authenticated;
grant select, insert on public.cloud_project_checkpoint_stages to authenticated;
grant select, insert on public.cloud_project_checkpoint_file_stages to authenticated;
grant select on public.cloud_project_checkpoints, public.cloud_project_checkpoint_files to authenticated;

create policy cloud_checkpoint_stages_select on public.cloud_project_checkpoint_stages
  for select to authenticated using (
    (actor_user_id = (select auth.uid()) and public.workspace_can(workspace_id, 'write'))
    or public.workspace_can(workspace_id, 'replace')
  );
create policy cloud_checkpoint_stages_insert on public.cloud_project_checkpoint_stages
  for insert to authenticated with check (
    actor_user_id = (select auth.uid())
    and public.workspace_can(workspace_id, 'write')
    and exists (select 1 from public.cloud_projects project
      where project.workspace_id = cloud_project_checkpoint_stages.workspace_id
        and project.project_id = cloud_project_checkpoint_stages.project_id
        and project.status = 'active')
  );
create policy cloud_checkpoint_file_stages_select on public.cloud_project_checkpoint_file_stages
  for select to authenticated using (
    exists (select 1 from public.cloud_project_checkpoint_stages stage
      where stage.checkpoint_id = cloud_project_checkpoint_file_stages.checkpoint_id
        and stage.workspace_id = cloud_project_checkpoint_file_stages.workspace_id
        and (stage.actor_user_id = (select auth.uid())
          or public.workspace_can(stage.workspace_id, 'replace')))
  );
create policy cloud_checkpoint_file_stages_insert on public.cloud_project_checkpoint_file_stages
  for insert to authenticated with check (
    exists (select 1 from public.cloud_project_checkpoint_stages stage
      where stage.checkpoint_id = cloud_project_checkpoint_file_stages.checkpoint_id
        and stage.workspace_id = cloud_project_checkpoint_file_stages.workspace_id
        and stage.project_id = cloud_project_checkpoint_file_stages.project_id
        and stage.actor_user_id = (select auth.uid())
        and public.workspace_can(stage.workspace_id, 'write')
        and file_id = any(stage.expected_file_ids)
        and storage_path = 'project-checkpoints/' || stage.workspace_id::text || '/'
          || stage.project_id || '/' || stage.checkpoint_id::text || '/' || file_id)
  );
create policy cloud_checkpoints_select_workspace on public.cloud_project_checkpoints
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and exists (select 1 from public.cloud_projects project
      where project.workspace_id = cloud_project_checkpoints.workspace_id
        and project.project_id = cloud_project_checkpoints.project_id
        and project.status = 'active')
  );
create policy cloud_checkpoint_files_select_workspace on public.cloud_project_checkpoint_files
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and exists (select 1 from public.cloud_project_checkpoints checkpoint
      where checkpoint.checkpoint_id = cloud_project_checkpoint_files.checkpoint_id
        and checkpoint.workspace_id = cloud_project_checkpoint_files.workspace_id
        and checkpoint.project_id = cloud_project_checkpoint_files.project_id
        and exists (select 1 from public.cloud_projects project
          where project.workspace_id = checkpoint.workspace_id
            and project.project_id = checkpoint.project_id and project.status = 'active'))
  );

-- Use the same transaction lock for ready-file set mutations and checkpoint
-- finalization so the guarded manifest check remains stable until commit.
create or replace function public.lock_cloud_project_checkpoint_file_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_workspace uuid;
  target_project text;
  project_status text;
begin
  if tg_op = 'DELETE' then
    target_workspace := old.workspace_id;
    target_project := old.project_id;
  else
    target_workspace := new.workspace_id;
    target_project := new.project_id;
  end if;
  select status into project_status from public.cloud_projects
    where workspace_id = target_workspace and project_id = target_project
    for update;
  if tg_op <> 'DELETE' and (not found or project_status = 'deleting') then
    raise exception 'Project deletion is in progress' using errcode = '40001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.lock_cloud_project_checkpoint_file_set() from public, anon, authenticated;
drop trigger if exists cloud_project_files_checkpoint_set_lock on public.cloud_project_files;
create trigger cloud_project_files_checkpoint_set_lock
  before insert or update or delete on public.cloud_project_files
  for each row execute function public.lock_cloud_project_checkpoint_file_set();

-- Atomic commit: lock and recheck the project revision/file set and parent,
-- ensure every staged private object exists, then publish checkpoint metadata.
create or replace function public.finalize_cloud_project_checkpoint(
  p_checkpoint_id uuid,
  p_expected_file_ids text[],
  p_expected_revision bigint,
  p_parent_checkpoint_id uuid,
  p_record_digest text,
  p_integrity_digest text,
  p_file_manifest jsonb,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  staged public.cloud_project_checkpoint_stages%rowtype;
  project_row public.cloud_projects%rowtype;
  actual_ready_ids text[];
  staged_ids text[];
  latest_checkpoint_id uuid;
  checkpoint_row public.cloud_project_checkpoints%rowtype;
  manifest_ids text[];
  manifest_entry jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_checkpoint_id::text));
  select * into staged from public.cloud_project_checkpoint_stages
    where checkpoint_id = p_checkpoint_id and actor_user_id = (select auth.uid());
  if not found then raise exception 'Checkpoint stage not found' using errcode = 'P0002'; end if;
  if not public.workspace_can(staged.workspace_id, 'write') then
    raise exception 'Checkpoint write permission is required' using errcode = '42501';
  end if;
  select * into project_row from public.cloud_projects
    where workspace_id = staged.workspace_id and project_id = staged.project_id
      and status = 'active'
    for update;
  if not found or project_row.record_revision <> p_expected_revision
    or staged.expected_revision <> p_expected_revision
    or staged.record is distinct from project_row.record then
    raise exception 'Project revision changed during checkpoint capture' using errcode = '40001';
  end if;
  select coalesce(array_agg(file_id order by file_id), '{}') into actual_ready_ids
    from public.cloud_project_files
    where workspace_id = staged.workspace_id and project_id = staged.project_id and state = 'ready';
  if actual_ready_ids is distinct from (
    select coalesce(array_agg(id order by id), '{}') from unnest(p_expected_file_ids) ids(id)
  ) or actual_ready_ids is distinct from (
    select coalesce(array_agg(id order by id), '{}') from unnest(staged.expected_file_ids) ids(id)
  ) then
    raise exception 'Ready project file set changed during checkpoint capture' using errcode = '40001';
  end if;
  select checkpoint_id into latest_checkpoint_id from public.cloud_project_checkpoints
    where workspace_id = staged.workspace_id and project_id = staged.project_id
    order by created_at desc, checkpoint_id desc limit 1;
  if latest_checkpoint_id is distinct from staged.parent_checkpoint_id
    or p_parent_checkpoint_id is distinct from staged.parent_checkpoint_id then
    raise exception 'Checkpoint parent changed during capture' using errcode = '40001';
  end if;
  select coalesce(array_agg(file_id order by file_id), '{}') into staged_ids
    from public.cloud_project_checkpoint_file_stages
    where checkpoint_id = staged.checkpoint_id;
  if staged_ids is distinct from actual_ready_ids then
    raise exception 'Checkpoint staged file set is incomplete' using errcode = '40001';
  end if;
  if jsonb_typeof(p_file_manifest) <> 'array'
    or jsonb_array_length(p_file_manifest) <> coalesce(array_length(staged_ids, 1), 0) then
    raise exception 'Checkpoint manifest is incomplete' using errcode = '40001';
  end if;
  select coalesce(array_agg(entry->>'fileId' order by entry->>'fileId'), '{}')
    into manifest_ids from jsonb_array_elements(p_file_manifest) as items(entry);
  if manifest_ids is distinct from staged_ids then
    raise exception 'Checkpoint manifest file IDs are duplicated or incomplete' using errcode = '40001';
  end if;
  for manifest_entry in select value from jsonb_array_elements(p_file_manifest)
  loop
    if not exists (
      select 1 from public.cloud_project_checkpoint_file_stages file
      where file.checkpoint_id = staged.checkpoint_id
        and file.file_id = manifest_entry->>'fileId'
        and file.name = manifest_entry->>'name'
        and file.type = manifest_entry->>'type'
        and file.size = (manifest_entry->>'size')::bigint
        and file.uploaded_at = (manifest_entry->>'uploadedAt')::bigint
        and file.sha256 = manifest_entry->>'sha256'
        and file.storage_path = manifest_entry->>'storageRef'
        and exists (select 1 from storage.objects object
          where object.bucket_id = 'project-checkpoints'
            and object.name = replace(file.storage_path, 'project-checkpoints/', ''))
    ) then
      raise exception 'Checkpoint object or manifest does not match staged metadata' using errcode = '40001';
    end if;
  end loop;
  insert into public.cloud_project_checkpoints (
    checkpoint_id, workspace_id, project_id, parent_checkpoint_id, reason, actor_user_id,
    created_at, originating_record_revision, record_schema_version, record_digest,
    integrity_digest, record, file_manifest
  ) values (
    staged.checkpoint_id, staged.workspace_id, staged.project_id, staged.parent_checkpoint_id,
    staged.reason, staged.actor_user_id, p_created_at, staged.expected_revision,
    (staged.record->>'schemaVersion')::integer, p_record_digest, p_integrity_digest,
    staged.record, p_file_manifest
  ) returning * into checkpoint_row;
  insert into public.cloud_project_checkpoint_files (
    checkpoint_id, workspace_id, project_id, file_id, name, type, size,
    uploaded_at, sha256, storage_path
  )
  select checkpoint_id, workspace_id, project_id, file_id, name, type, size,
    uploaded_at, sha256, storage_path
  from public.cloud_project_checkpoint_file_stages
  where checkpoint_id = staged.checkpoint_id;
  delete from public.cloud_project_checkpoint_stages where checkpoint_id = staged.checkpoint_id;
  return to_jsonb(checkpoint_row);
end;
$function$;
revoke all on function public.finalize_cloud_project_checkpoint(uuid, text[], bigint, uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.finalize_cloud_project_checkpoint(uuid, text[], bigint, uuid, text, text, jsonb, timestamptz) to authenticated;

create or replace function public.abandon_cloud_project_checkpoint(p_checkpoint_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  staged public.cloud_project_checkpoint_stages%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_checkpoint_id::text));
  select * into staged from public.cloud_project_checkpoint_stages where checkpoint_id = p_checkpoint_id;
  if not found then return true; end if;
  if not (
    (staged.actor_user_id = (select auth.uid())
      and public.workspace_can(staged.workspace_id, 'write'))
    or public.workspace_can(staged.workspace_id, 'replace')
  ) then
    raise exception 'Cannot abandon another caller checkpoint stage' using errcode = '42501';
  end if;
  if exists (select 1 from storage.objects object
    where object.bucket_id = 'project-checkpoints'
      and split_part(object.name, '/', 1) = staged.workspace_id::text
      and split_part(object.name, '/', 2) = staged.project_id
      and split_part(object.name, '/', 3) = staged.checkpoint_id::text) then
    raise exception 'Checkpoint archive objects remain; remove them before cleanup' using errcode = '40001';
  end if;
  delete from public.cloud_project_checkpoint_stages where checkpoint_id = staged.checkpoint_id;
  return true;
end;
$function$;
revoke all on function public.abandon_cloud_project_checkpoint(uuid) from public, anon;
grant execute on function public.abandon_cloud_project_checkpoint(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-checkpoints', 'project-checkpoints', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists project_checkpoints_read_authorized on storage.objects;
create policy project_checkpoints_read_authorized on storage.objects
  for select to authenticated using (
    bucket_id = 'project-checkpoints'
    and exists (select 1 from public.cloud_project_checkpoint_files file
      where file.storage_path = 'project-checkpoints/' || storage.objects.name
        and public.workspace_can(file.workspace_id, 'read'))
  );
drop policy if exists project_checkpoints_insert_staged on storage.objects;
create policy project_checkpoints_insert_staged on storage.objects
  for insert to authenticated with check (
    bucket_id = 'project-checkpoints'
    and exists (select 1 from public.cloud_project_checkpoint_file_stages file
      join public.cloud_project_checkpoint_stages stage
        on stage.checkpoint_id = file.checkpoint_id
       and stage.workspace_id = file.workspace_id
       and stage.project_id = file.project_id
      where file.storage_path = 'project-checkpoints/' || storage.objects.name
        and stage.actor_user_id = (select auth.uid())
        and public.workspace_can(stage.workspace_id, 'write')
        and file.file_id = any(stage.expected_file_ids))
  );
drop policy if exists project_checkpoints_delete_staged on storage.objects;
create policy project_checkpoints_delete_staged on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-checkpoints'
    and exists (select 1 from public.cloud_project_checkpoint_file_stages file
      join public.cloud_project_checkpoint_stages stage
        on stage.checkpoint_id = file.checkpoint_id
       and stage.workspace_id = file.workspace_id
      where file.storage_path = 'project-checkpoints/' || storage.objects.name
        and (
          (stage.actor_user_id = (select auth.uid()) and public.workspace_can(stage.workspace_id, 'write'))
          or public.workspace_can(stage.workspace_id, 'replace')))
  );

insert into public.cloud_schema_versions (component, version)
values ('project-checkpoints', 1)
on conflict (component) do update set version = excluded.version;

comment on table public.cloud_project_checkpoints is
  'Immutable workspace-scoped project checkpoints. Archive objects are retained until an authorized atomic project-deletion tombstone begins retryable cleanup.';
comment on table public.cloud_project_checkpoint_files is
  'Immutable archive file metadata bound to private project-checkpoints object keys.';

-- Checkpoint object verification occurs while the draft is still private. Only
-- the draft's actor can read its staged archive objects; workspace readers see
-- committed objects only while their project is active.
drop policy if exists project_checkpoints_read_authorized on storage.objects;
create policy project_checkpoints_read_authorized on storage.objects
  for select to authenticated using (
    bucket_id = 'project-checkpoints'
    and (
      exists (select 1 from public.cloud_project_checkpoint_files file
        where file.storage_path = 'project-checkpoints/' || storage.objects.name
          and public.workspace_can(file.workspace_id, 'read')
          and exists (select 1 from public.cloud_projects project
            where project.workspace_id = file.workspace_id
              and project.project_id = file.project_id and project.status = 'active'))
      or exists (select 1 from public.cloud_project_checkpoint_file_stages file
        join public.cloud_project_checkpoint_stages stage
          on stage.checkpoint_id = file.checkpoint_id
         and stage.workspace_id = file.workspace_id
         and stage.project_id = file.project_id
        where file.storage_path = 'project-checkpoints/' || storage.objects.name
          and stage.actor_user_id = (select auth.uid())
          and public.workspace_can(stage.workspace_id, 'write'))
    )
  );

-- A whole-project deletion first atomically hides and invalidates the project
-- and all checkpoint metadata. Object references survive independently until
-- every private object has been removed and the tombstone can be finalized.
alter table public.cloud_projects drop constraint if exists cloud_projects_status_check;
alter table public.cloud_projects add constraint cloud_projects_status_check
  check (status in ('active', 'staging', 'deleting'));
drop policy if exists cloud_projects_select_workspace on public.cloud_projects;
create policy cloud_projects_select_workspace on public.cloud_projects
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and (status = 'active' or (status = 'staging' and owner_user_id = (select auth.uid())))
  );
drop policy if exists cloud_projects_update_workspace on public.cloud_projects;
create policy cloud_projects_update_workspace on public.cloud_projects
  for update to authenticated using (
    status = 'active' and public.workspace_can(workspace_id, 'write')
  ) with check (
    status = 'active'
    and public.workspace_can(workspace_id, 'write')
    and record->>'ownerUserId' = owner_user_id::text
    and record->>'workspaceId' = workspace_id::text
    and record->>'projectId' = project_id
    and record->>'recordRevision' = record_revision::text
  );

alter table public.cloud_project_checkpoints
  drop constraint if exists cloud_project_checkpoints_parent_checkpoint_id_fkey;
alter table public.cloud_project_checkpoints
  add constraint cloud_project_checkpoints_parent_checkpoint_id_fkey
  foreign key (parent_checkpoint_id)
  references public.cloud_project_checkpoints(checkpoint_id) on delete cascade;

create table if not exists public.cloud_project_deletions (
  deletion_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  project_id text not null,
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, project_id)
);
create table if not exists public.cloud_project_deletion_objects (
  deletion_id uuid not null references public.cloud_project_deletions(deletion_id) on delete cascade,
  object_ref text not null,
  primary key (deletion_id, object_ref),
  check (object_ref ~ '^(project-files|project-checkpoints)/.+$')
);
alter table public.cloud_project_deletions enable row level security;
alter table public.cloud_project_deletion_objects enable row level security;
revoke all on public.cloud_project_deletions, public.cloud_project_deletion_objects from public, anon, authenticated;
grant select on public.cloud_project_deletions, public.cloud_project_deletion_objects to authenticated;
create policy cloud_project_deletions_select_authorized on public.cloud_project_deletions
  for select to authenticated using (public.workspace_can(workspace_id, 'delete'));
create policy cloud_project_deletion_objects_select_authorized on public.cloud_project_deletion_objects
  for select to authenticated using (
    exists (select 1 from public.cloud_project_deletions deletion
      where deletion.deletion_id = cloud_project_deletion_objects.deletion_id
        and public.workspace_can(deletion.workspace_id, 'delete'))
  );

-- Once committed rows have been invalidated, only an authorized delete-role
-- member can read their objects through the durable cleanup tombstone.
drop policy if exists project_checkpoints_read_authorized on storage.objects;
create policy project_checkpoints_read_authorized on storage.objects
  for select to authenticated using (
    bucket_id = 'project-checkpoints'
    and (
      exists (select 1 from public.cloud_project_checkpoint_files file
        where file.storage_path = 'project-checkpoints/' || storage.objects.name
          and public.workspace_can(file.workspace_id, 'read')
          and exists (select 1 from public.cloud_projects project
            where project.workspace_id = file.workspace_id
              and project.project_id = file.project_id and project.status = 'active'))
      or exists (select 1 from public.cloud_project_checkpoint_file_stages file
        join public.cloud_project_checkpoint_stages stage
          on stage.checkpoint_id = file.checkpoint_id
         and stage.workspace_id = file.workspace_id
         and stage.project_id = file.project_id
        where file.storage_path = 'project-checkpoints/' || storage.objects.name
          and stage.actor_user_id = (select auth.uid())
          and public.workspace_can(stage.workspace_id, 'write'))
      or exists (select 1 from public.cloud_project_deletion_objects entry
        join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
        where entry.object_ref = 'project-checkpoints/' || storage.objects.name
          and deletion.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and public.workspace_can(deletion.workspace_id, 'delete'))
    )
  );

-- Capture drafts and restore stages lock their parent before they are created.
-- This serializes their object publication against the deleting transition.
create or replace function public.lock_cloud_project_staging_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_workspace uuid;
  target_project text;
  project_status text;
begin
  if tg_table_name = 'cloud_project_checkpoint_stages' then
    if tg_op = 'DELETE' then
      target_workspace := old.workspace_id;
      target_project := old.project_id;
    else
      target_workspace := new.workspace_id;
      target_project := new.project_id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_workspace := old.workspace_id;
      target_project := old.project_id;
    else
      target_workspace := new.workspace_id;
      target_project := new.project_id;
    end if;
  end if;
  select status into project_status from public.cloud_projects
    where workspace_id = target_workspace and project_id = target_project
    for update;
  if tg_op <> 'DELETE' and (
    not found
    or (project_status = 'deleting'
      and not (tg_table_name = 'cloud_project_restore_stages'
        and tg_op = 'UPDATE' and new.state = 'abandoning'))
  ) then
    raise exception 'Project deletion is in progress' using errcode = '40001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.lock_cloud_project_staging_mutation() from public, anon, authenticated;
drop trigger if exists cloud_checkpoint_stages_project_lock on public.cloud_project_checkpoint_stages;
create trigger cloud_checkpoint_stages_project_lock
  before insert or update or delete on public.cloud_project_checkpoint_stages
  for each row execute function public.lock_cloud_project_staging_mutation();
drop trigger if exists cloud_restore_stages_project_lock on public.cloud_project_restore_stages;
create trigger cloud_restore_stages_project_lock
  before insert or update or delete on public.cloud_project_restore_stages
  for each row execute function public.lock_cloud_project_staging_mutation();

-- Storage object publication also holds the project row lock until its object
-- transaction commits. This closes the race where deletion could miss a late
-- upload after collecting its object manifest.
create or replace function public.lock_cloud_project_storage_object_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_workspace uuid;
  target_project text;
  project_status text;
begin
  if new.bucket_id = 'project-files' then
    select workspace_id, project_id into target_workspace, target_project
      from public.cloud_project_files
      where storage_path = 'project-files/' || new.name
        and state in ('uploading', 'staged', 'ready');
  elsif new.bucket_id = 'project-checkpoints' then
    select workspace_id, project_id into target_workspace, target_project
      from public.cloud_project_checkpoint_file_stages
      where storage_path = 'project-checkpoints/' || new.name;
  else
    return new;
  end if;
  if not found then
    raise exception 'Storage object has no active project upload stage' using errcode = '42501';
  end if;
  select status into project_status from public.cloud_projects
    where workspace_id = target_workspace and project_id = target_project
    for update;
  if not found or project_status = 'deleting' then
    raise exception 'Project deletion is in progress' using errcode = '40001';
  end if;
  return new;
end;
$function$;
revoke all on function public.lock_cloud_project_storage_object_insert() from public, anon, authenticated;
drop trigger if exists cloud_project_storage_insert_lock on storage.objects;
create trigger cloud_project_storage_insert_lock
  before insert on storage.objects
  for each row execute function public.lock_cloud_project_storage_object_insert();

create or replace function public.begin_cloud_project_deletion(p_project_id text, p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project_row public.cloud_projects%rowtype;
  deletion public.cloud_project_deletions%rowtype;
begin
  select * into project_row from public.cloud_projects
    where workspace_id = p_workspace_id and project_id = p_project_id
      and status in ('active', 'deleting')
    for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not public.workspace_can(project_row.workspace_id, 'delete') then
    raise exception 'Project deletion permission is required' using errcode = '42501';
  end if;
  if project_row.status = 'deleting' then
    select * into deletion from public.cloud_project_deletions
      where workspace_id = project_row.workspace_id and project_id = p_project_id;
    if not found then raise exception 'Project deletion tombstone is missing' using errcode = '40001'; end if;
    return deletion.deletion_id;
  end if;

  insert into public.cloud_project_deletions (workspace_id, project_id, requested_by)
    values (project_row.workspace_id, p_project_id, (select auth.uid()))
    returning * into deletion;
  update public.cloud_projects set status = 'deleting'
    where workspace_id = project_row.workspace_id and project_id = p_project_id;

  insert into public.cloud_project_deletion_objects (deletion_id, object_ref)
  select deletion.deletion_id, object_ref
  from (
    select file.storage_path as object_ref
      from public.cloud_project_files file
      where file.workspace_id = project_row.workspace_id and file.project_id = p_project_id
    union
    select file.storage_path
      from public.cloud_project_checkpoint_files file
      where file.workspace_id = project_row.workspace_id and file.project_id = p_project_id
    union
    select file.storage_path
      from public.cloud_project_checkpoint_file_stages file
      where file.workspace_id = project_row.workspace_id and file.project_id = p_project_id
    union
    select object.bucket_id || '/' || object.name
      from storage.objects object
      where object.bucket_id = 'project-files'
        and (left(object.name, char_length(project_row.workspace_id::text || '/' || p_project_id || '/'))
              = project_row.workspace_id::text || '/' || p_project_id || '/'
          or exists (select 1 from public.cloud_project_restore_stages stage
            where stage.workspace_id = project_row.workspace_id and stage.project_id = p_project_id
              and left(object.name, char_length(project_row.workspace_id::text || '/_staging/' || stage.stage_id::text || '/'))
                = project_row.workspace_id::text || '/_staging/' || stage.stage_id::text || '/'))
    union
    select object.bucket_id || '/' || object.name
      from storage.objects object
      where object.bucket_id = 'project-checkpoints'
        and left(object.name, char_length(project_row.workspace_id::text || '/' || p_project_id || '/'))
          = project_row.workspace_id::text || '/' || p_project_id || '/'
  ) objects
  where object_ref is not null
  on conflict do nothing;

  delete from public.cloud_project_checkpoint_files
    where workspace_id = project_row.workspace_id and project_id = p_project_id;
  delete from public.cloud_project_checkpoints
    where workspace_id = project_row.workspace_id and project_id = p_project_id;
  delete from public.cloud_project_checkpoint_stages
    where workspace_id = project_row.workspace_id and project_id = p_project_id;
  delete from public.cloud_project_files
    where workspace_id = project_row.workspace_id and project_id = p_project_id
      and stage_id is null;
  -- Restore-stage rows are abandoned after this transaction commits. Their
  -- existing advisory-lock protocol serializes abandonment against finalizers.
  return deletion.deletion_id;
end;
$function$;
revoke all on function public.begin_cloud_project_deletion(text, uuid) from public, anon;
grant execute on function public.begin_cloud_project_deletion(text, uuid) to authenticated;

create or replace function public.finish_cloud_project_deletion(p_deletion_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deletion public.cloud_project_deletions%rowtype;
begin
  select * into deletion from public.cloud_project_deletions
    where deletion_id = p_deletion_id for update;
  if not found then return true; end if;
  if not public.workspace_can(deletion.workspace_id, 'delete') then
    raise exception 'Project deletion permission is required' using errcode = '42501';
  end if;
  perform 1 from public.cloud_projects
    where workspace_id = deletion.workspace_id and project_id = deletion.project_id
      and status = 'deleting'
    for update;
  if not found then
    raise exception 'Deleting project tombstone is inconsistent' using errcode = '40001';
  end if;
  if exists (select 1 from public.cloud_project_files
      where workspace_id = deletion.workspace_id and project_id = deletion.project_id)
    or exists (select 1 from public.cloud_project_restore_stages
      where workspace_id = deletion.workspace_id and project_id = deletion.project_id) then
    raise exception 'Project restore stages remain; retry their cleanup before final deletion' using errcode = '40001';
  end if;
  if exists (select 1 from public.cloud_project_deletion_objects entry
      join storage.objects object
        on object.bucket_id = split_part(entry.object_ref, '/', 1)
       and object.name = substring(entry.object_ref from strpos(entry.object_ref, '/') + 1)
      where entry.deletion_id = deletion.deletion_id) then
    raise exception 'Project storage objects remain; retry deletion cleanup' using errcode = '40001';
  end if;
  perform set_config(
    'app.cloud_project_deletion_finalizer',
    deletion.workspace_id::text || '/' || deletion.project_id,
    true
  );
  delete from public.cloud_projects
    where workspace_id = deletion.workspace_id and project_id = deletion.project_id and status = 'deleting';
  delete from public.cloud_project_deletions where deletion_id = deletion.deletion_id;
  return true;
end;
$function$;
revoke all on function public.finish_cloud_project_deletion(uuid) from public, anon;
grant execute on function public.finish_cloud_project_deletion(uuid) to authenticated;

create or replace function public.guard_cloud_project_delete_protocol()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'staging'
    and (
      public.workspace_can(old.workspace_id, 'replace')
      or (old.owner_user_id = (select auth.uid())
        and public.workspace_can(old.workspace_id, 'restore-new'))
    ) then
    return old;
  end if;
  if current_setting('app.cloud_project_deletion_finalizer', true)
    = old.workspace_id::text || '/' || old.project_id then
    return old;
  end if;
  raise exception 'Use the authorized project deletion protocol'
    using errcode = '42501';
end;
$function$;
revoke all on function public.guard_cloud_project_delete_protocol() from public, anon, authenticated;
drop trigger if exists cloud_projects_require_deletion_protocol on public.cloud_projects;
create trigger cloud_projects_require_deletion_protocol
  before delete on public.cloud_projects
  for each row execute function public.guard_cloud_project_delete_protocol();

-- Preserve the original private-file read/delete rules and add access to
-- tombstoned cleanup objects for authorized delete-role members only.
drop policy if exists project_files_read_authorized on storage.objects;
create policy project_files_read_authorized on storage.objects
  for select to authenticated using (
    bucket_id = 'project-files'
    and (
      exists (select 1 from public.cloud_project_files f
        where f.storage_path = 'project-files/' || storage.objects.name
          and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and (
            (f.state = 'ready' and public.workspace_can(f.workspace_id, 'read'))
            or (f.state = 'uploading' and public.workspace_can(f.workspace_id, 'write'))
            or (f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))
            or (f.state = 'staged' and exists (
              select 1 from public.cloud_project_restore_stages s
              where s.stage_id = f.stage_id and s.workspace_id = f.workspace_id
                and (s.owner_user_id = (select auth.uid()) or public.workspace_can(s.workspace_id, 'replace'))))
          ))
      or exists (select 1 from public.cloud_project_deletion_objects entry
        join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
        where entry.object_ref = 'project-files/' || storage.objects.name
          and deletion.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and public.workspace_can(deletion.workspace_id, 'delete'))
    )
  );
drop policy if exists project_files_delete_authorized on storage.objects;
create policy project_files_delete_authorized on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-files'
    and (
      exists (select 1 from public.cloud_project_files f
        where f.storage_path = 'project-files/' || storage.objects.name
          and (
            (f.state in ('ready', 'uploading') and public.workspace_can(f.workspace_id, 'write'))
            or (f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))
            or (f.state = 'staged' and exists (
              select 1 from public.cloud_project_restore_stages stage
              where stage.stage_id = f.stage_id and stage.workspace_id = f.workspace_id
                and (stage.owner_user_id = (select auth.uid()) or public.workspace_can(stage.workspace_id, 'replace'))))
          ))
      or exists (select 1 from public.cloud_project_deletion_objects entry
        join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
        where entry.object_ref = 'project-files/' || storage.objects.name
          and public.workspace_can(deletion.workspace_id, 'delete'))
    )
  );
drop policy if exists project_checkpoints_delete_for_project_deletion on storage.objects;
create policy project_checkpoints_delete_for_project_deletion on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-checkpoints'
    and exists (select 1 from public.cloud_project_deletion_objects entry
      join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
      where entry.object_ref = 'project-checkpoints/' || storage.objects.name
        and public.workspace_can(deletion.workspace_id, 'delete'))
  );

-- Storage RLS authorizes the request, then this security-definer trigger
-- serializes object deletion with checkpoint finalization. Both take the
-- checkpoint advisory lock before the project row lock; a staged delete that
-- loses the race to finalization is rejected after metadata is rechecked.
create or replace function public.guard_cloud_project_checkpoint_object_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_workspace uuid;
  target_project text;
  target_checkpoint uuid;
  project_status text;
  staged_exists boolean;
  committed_exists boolean;
  tombstone_exists boolean;
begin
  if old.bucket_id <> 'project-checkpoints' then
    return old;
  end if;

  select file.workspace_id, file.project_id, file.checkpoint_id
    into target_workspace, target_project, target_checkpoint
    from public.cloud_project_checkpoint_file_stages file
    where file.storage_path = 'project-checkpoints/' || old.name
    limit 1;
  if not found then
    select file.workspace_id, file.project_id, file.checkpoint_id
      into target_workspace, target_project, target_checkpoint
      from public.cloud_project_checkpoint_files file
      where file.storage_path = 'project-checkpoints/' || old.name
      limit 1;
  end if;
  if found then
    perform pg_advisory_xact_lock(hashtext(target_checkpoint::text));
  else
    select deletion.workspace_id, deletion.project_id
      into target_workspace, target_project
      from public.cloud_project_deletion_objects entry
      join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
      where entry.object_ref = 'project-checkpoints/' || old.name
      limit 1;
    if not found then
      raise exception 'Checkpoint object is not staged or tombstoned for deletion'
        using errcode = '42501';
    end if;
  end if;

  select status into project_status from public.cloud_projects
    where workspace_id = target_workspace and project_id = target_project
    for update;
  if not found then
    raise exception 'Checkpoint project is no longer available for object cleanup'
      using errcode = '40001';
  end if;

  select exists (
    select 1
      from public.cloud_project_checkpoint_file_stages file
      join public.cloud_project_checkpoint_stages stage
        on stage.checkpoint_id = file.checkpoint_id
       and stage.workspace_id = file.workspace_id
       and stage.project_id = file.project_id
      where file.storage_path = 'project-checkpoints/' || old.name
        and file.workspace_id = target_workspace
        and file.project_id = target_project
  ) into staged_exists;
  select exists (
    select 1 from public.cloud_project_checkpoint_files file
      where file.storage_path = 'project-checkpoints/' || old.name
        and file.workspace_id = target_workspace
        and file.project_id = target_project
  ) into committed_exists;
  select exists (
    select 1 from public.cloud_project_deletion_objects entry
      join public.cloud_project_deletions deletion on deletion.deletion_id = entry.deletion_id
      where entry.object_ref = 'project-checkpoints/' || old.name
        and deletion.workspace_id = target_workspace
        and deletion.project_id = target_project
  ) into tombstone_exists;

  if staged_exists and not committed_exists and project_status = 'active' then
    return old;
  end if;
  if tombstone_exists and not staged_exists and not committed_exists
    and project_status = 'deleting' then
    return old;
  end if;
  raise exception 'Checkpoint object is committed or no longer safely deletable'
    using errcode = '42501';
end;
$function$;
revoke all on function public.guard_cloud_project_checkpoint_object_delete() from public, anon, authenticated;
drop trigger if exists project_checkpoint_object_delete_guard on storage.objects;
create trigger project_checkpoint_object_delete_guard
  before delete on storage.objects
  for each row execute function public.guard_cloud_project_checkpoint_object_delete();

insert into public.cloud_schema_versions (component, version)
values ('project-checkpoints', 3)
on conflict (component) do update set version = excluded.version;