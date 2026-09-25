-- Workspace-scoped cloud project JSON and private file metadata.
-- Apply this migration before enabling /api/cloud-projects. No data is
-- automatically imported or migrated from browser IndexedDB.

create or replace function public.workspace_can(p_workspace_id uuid, p_permission text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.workspace_memberships as membership
    join public.workspace_role_permissions as permission
      on permission.role = membership.role
     and permission.permission = p_permission
    where membership.workspace_id = p_workspace_id
      and membership.user_id = (select auth.uid())
  );
$function$;

revoke all on function public.workspace_can(uuid, text) from public, anon;
grant execute on function public.workspace_can(uuid, text) to authenticated;

create table if not exists public.cloud_projects (
  project_id text primary key check (char_length(project_id) between 1 and 256),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  record_revision bigint not null default 0 check (record_revision >= 0),
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  status text not null default 'active' check (status in ('active', 'staging')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, project_id)
);
create index if not exists cloud_projects_workspace_updated
  on public.cloud_projects (workspace_id, updated_at desc);
alter table public.cloud_projects enable row level security;
revoke all on public.cloud_projects from public, anon, authenticated;
grant select, insert, delete on public.cloud_projects to authenticated;
-- Ownership/workspace/project identity columns are immutable for content saves.
grant update (record_revision, record, updated_at) on public.cloud_projects to authenticated;

drop policy if exists cloud_projects_select_workspace on public.cloud_projects;
create policy cloud_projects_select_workspace on public.cloud_projects
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and (status = 'active' or owner_user_id = (select auth.uid()))
  );
drop policy if exists cloud_projects_insert_workspace on public.cloud_projects;
create policy cloud_projects_insert_workspace on public.cloud_projects
  for insert to authenticated with check (
    owner_user_id = (select auth.uid())
    and (public.workspace_can(workspace_id, 'create')
      or (status = 'staging' and public.workspace_can(workspace_id, 'restore-new')))
    and record->>'ownerUserId' = owner_user_id::text
    and record->>'workspaceId' = workspace_id::text
    and record->>'projectId' = project_id
    and record->>'recordRevision' = '0'
  );
drop policy if exists cloud_projects_update_workspace on public.cloud_projects;
create policy cloud_projects_update_workspace on public.cloud_projects
  for update to authenticated using (
    public.workspace_can(workspace_id, 'write')
  ) with check (
    public.workspace_can(workspace_id, 'write')
    and record->>'ownerUserId' = owner_user_id::text
    and record->>'workspaceId' = workspace_id::text
    and record->>'projectId' = project_id
    and record->>'recordRevision' = record_revision::text
  );
drop policy if exists cloud_projects_delete_workspace on public.cloud_projects;
create policy cloud_projects_delete_workspace on public.cloud_projects
  for delete to authenticated using (public.workspace_can(workspace_id, 'delete'));

create table if not exists public.cloud_project_restore_stages (
  stage_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  project_id text not null,
  mode text not null check (mode in ('new', 'replace')),
  expected_revision bigint,
  expected_file_ids text[] not null default '{}',
  staged_file_ids text[] not null default '{}',
  staged_record jsonb not null check (jsonb_typeof(staged_record) = 'object'),
  state text not null default 'open' check (state in ('open', 'abandoning')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete restrict,
  check ((mode = 'new' and expected_revision is null) or (mode = 'replace' and expected_revision >= 0))
);
alter table public.cloud_project_restore_stages enable row level security;
revoke all on public.cloud_project_restore_stages from public, anon, authenticated;
grant select, insert on public.cloud_project_restore_stages to authenticated;
drop policy if exists cloud_restore_stages_select_self on public.cloud_project_restore_stages;
drop policy if exists cloud_restore_stages_select_authorized on public.cloud_project_restore_stages;
create policy cloud_restore_stages_select_authorized on public.cloud_project_restore_stages
  for select to authenticated using (
    public.workspace_can(workspace_id, case when mode = 'new' then 'restore-new' else 'replace' end)
  );
drop policy if exists cloud_restore_stages_insert_self on public.cloud_project_restore_stages;
create policy cloud_restore_stages_insert_self on public.cloud_project_restore_stages
  for insert to authenticated with check (
    owner_user_id = (select auth.uid())
    and state = 'open'
    and public.workspace_can(workspace_id, case when mode = 'new' then 'restore-new' else 'replace' end)
  );
drop policy if exists cloud_restore_stages_delete_self on public.cloud_project_restore_stages;

create table if not exists public.cloud_project_files (
  file_row_id uuid primary key default gen_random_uuid(),
  file_id text not null check (char_length(file_id) between 1 and 256),
  project_id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stage_id uuid references public.cloud_project_restore_stages(stage_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 512),
  type text not null default 'application/octet-stream',
  size bigint not null check (size >= 0 and size <= 104857600),
  uploaded_at bigint not null,
  storage_path text not null unique,
  state text not null check (state in ('ready', 'uploading', 'staged', 'cleanup')),
  cleanup_owner_user_id uuid references auth.users(id),
  check ((state = 'cleanup' and cleanup_owner_user_id is not null and stage_id is null)
    or (state <> 'cleanup' and cleanup_owner_user_id is null)),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade
);
create unique index if not exists cloud_project_files_active_id_unique
  on public.cloud_project_files (file_id) where state in ('ready', 'uploading');
create unique index if not exists cloud_project_files_stage_id_unique
  on public.cloud_project_files (stage_id, file_id) where state = 'staged';
create index if not exists cloud_project_files_by_project
  on public.cloud_project_files (workspace_id, project_id, state);
alter table public.cloud_project_files enable row level security;
revoke all on public.cloud_project_files from public, anon, authenticated;
grant select, insert on public.cloud_project_files to authenticated;
drop policy if exists cloud_project_files_select_workspace on public.cloud_project_files;
create policy cloud_project_files_select_workspace on public.cloud_project_files
  for select to authenticated using (
    (
      state = 'ready'
      and public.workspace_can(workspace_id, 'read')
      and exists (select 1 from public.cloud_projects p
        where p.project_id = cloud_project_files.project_id
          and p.workspace_id = cloud_project_files.workspace_id and p.status = 'active')
    ) or (
      state = 'uploading'
      and public.workspace_can(workspace_id, 'write')
      and exists (select 1 from public.cloud_projects p
        where p.project_id = cloud_project_files.project_id
          and p.workspace_id = cloud_project_files.workspace_id and p.status = 'active')
    ) or (
      state = 'staged'
      and exists (select 1 from public.cloud_project_restore_stages s
        where s.stage_id = cloud_project_files.stage_id
          and s.workspace_id = cloud_project_files.workspace_id
          and (s.owner_user_id = (select auth.uid()) or public.workspace_can(s.workspace_id, 'replace')))
    ) or (
      state = 'cleanup'
      and public.workspace_can(workspace_id, 'replace')
    )
  );
drop policy if exists cloud_project_files_insert_workspace on public.cloud_project_files;
create policy cloud_project_files_insert_workspace on public.cloud_project_files
  for insert to authenticated with check (
    (state = 'uploading' and stage_id is null and public.workspace_can(workspace_id, 'write')
      and exists (select 1 from public.cloud_projects p where p.project_id = cloud_project_files.project_id
        and p.workspace_id = cloud_project_files.workspace_id and p.status = 'active'))
    or (state = 'staged' and stage_id is not null
      and exists (select 1 from public.cloud_project_restore_stages s
        where s.stage_id = cloud_project_files.stage_id
          and s.workspace_id = cloud_project_files.workspace_id
          and s.project_id = cloud_project_files.project_id
          and cloud_project_files.file_id = any(s.staged_file_ids)
          and s.state = 'open'
          and s.owner_user_id = (select auth.uid())))
  );
drop policy if exists cloud_project_files_delete_workspace on public.cloud_project_files;
create policy cloud_project_files_delete_workspace on public.cloud_project_files
  for delete to authenticated using (false);

-- Serialize any staged-file metadata change against finalization without
-- requiring UPDATE privilege on restore-stage rows (SELECT FOR UPDATE needs
-- UPDATE privilege even when no columns are changed).
create or replace function public.lock_cloud_restore_stage_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_table_name = 'cloud_project_restore_stages' then
    if old.stage_id is not null then
      perform pg_advisory_xact_lock(hashtext(old.stage_id::text));
    end if;
    return old;
  end if;

    if tg_op <> 'INSERT' and old.stage_id is not null then
      perform pg_advisory_xact_lock(hashtext(old.stage_id::text));
    end if;
    if tg_op <> 'DELETE' and new.stage_id is not null then
      perform pg_advisory_xact_lock(hashtext(new.stage_id::text));
      if new.state = 'staged' then
        if not exists (
          select 1 from public.cloud_project_restore_stages as stage
          where stage.stage_id = new.stage_id
            and stage.workspace_id = new.workspace_id
            and stage.project_id = new.project_id
            and stage.owner_user_id = (select auth.uid())
            and stage.state = 'open'
            and new.file_id = any(stage.staged_file_ids)
        ) then
          raise exception 'File is not part of this caller-owned restore manifest'
            using errcode = '42501';
        end if;
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$function$;
revoke all on function public.lock_cloud_restore_stage_mutation() from public, anon, authenticated;

drop trigger if exists cloud_project_files_lock_restore_stage on public.cloud_project_files;
create trigger cloud_project_files_lock_restore_stage
  before insert or update or delete on public.cloud_project_files
  for each row execute function public.lock_cloud_restore_stage_mutation();
drop trigger if exists cloud_restore_stages_lock_delete on public.cloud_project_restore_stages;
create trigger cloud_restore_stages_lock_delete
  before delete on public.cloud_project_restore_stages
  for each row execute function public.lock_cloud_restore_stage_mutation();

create or replace function public.prevent_cloud_project_delete_with_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.cloud_project_files as file
    where file.workspace_id = old.workspace_id and file.project_id = old.project_id
  ) or exists (
    select 1 from public.cloud_project_restore_stages as stage
    where stage.workspace_id = old.workspace_id and stage.project_id = old.project_id
  ) then
    raise exception 'Project has file metadata or restore stages; clean those resources first'
      using errcode = '23503';
  end if;
  return old;
end;
$function$;
revoke all on function public.prevent_cloud_project_delete_with_resources() from public, anon, authenticated;
drop trigger if exists cloud_projects_require_resource_cleanup on public.cloud_projects;
create trigger cloud_projects_require_resource_cleanup
  before delete on public.cloud_projects
  for each row execute function public.prevent_cloud_project_delete_with_resources();

create or replace function public.finalize_cloud_project_restore(
  p_stage_id uuid,
  p_expected_file_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  staged public.cloud_project_restore_stages%rowtype;
  project_row public.cloud_projects%rowtype;
  actual_ids text[];
  destination_ids text[];
  new_record jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_stage_id::text));
  select * into staged from public.cloud_project_restore_stages
    where stage_id = p_stage_id and owner_user_id = (select auth.uid());
  if not found then raise exception 'Restore stage not found' using errcode = 'P0002'; end if;
  if staged.state <> 'open' then
    raise exception 'Restore stage is being abandoned' using errcode = '40001';
  end if;
  if not public.workspace_can(
    staged.workspace_id,
    case when staged.mode = 'new' then 'restore-new' else 'replace' end
  ) then
    raise exception 'Current workspace role cannot finalize this restore' using errcode = '42501';
  end if;
  if coalesce(array_length(p_expected_file_ids, 1), 0) <> coalesce(array_length(staged.staged_file_ids, 1), 0)
    or exists (select 1 from unnest(staged.staged_file_ids) as ids(id) where not (id = any(p_expected_file_ids))) then
    raise exception 'Finalize file IDs differ from staged manifest' using errcode = '40001';
  end if;
  select coalesce(array_agg(file_id order by file_id), '{}') into actual_ids
    from public.cloud_project_files where stage_id = staged.stage_id and state = 'staged';
  if actual_ids is distinct from (
    select coalesce(array_agg(id order by id), '{}')
    from unnest(staged.staged_file_ids) as ids(id)
  ) then
    raise exception 'Restore file set is incomplete or changed' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.cloud_project_files as file
    where file.stage_id = staged.stage_id and file.state = 'staged'
      and not exists (
        select 1 from storage.objects as object
        where object.bucket_id = 'project-files'
          and object.name = substring(file.storage_path from 15)
      )
  ) then
    raise exception 'A staged Storage object is missing' using errcode = '40001';
  end if;

  if staged.mode = 'new' then
    update public.cloud_projects set status = 'active'
      where project_id = staged.project_id and workspace_id = staged.workspace_id
        and owner_user_id = (select auth.uid()) and status = 'staging'
      returning * into project_row;
    if not found then raise exception 'Staged project not found' using errcode = 'P0002'; end if;
  else
    select * into project_row from public.cloud_projects
      where project_id = staged.project_id and workspace_id = staged.workspace_id
        and status = 'active' and record_revision = staged.expected_revision for update;
    if not found then raise exception 'Destination project changed or is missing' using errcode = '40001'; end if;
    select coalesce(array_agg(file_id order by file_id), '{}') into destination_ids
      from public.cloud_project_files where project_id = staged.project_id and workspace_id = staged.workspace_id and state = 'ready';
    if destination_ids is distinct from (
      select coalesce(array_agg(id order by id), '{}')
      from unnest(staged.expected_file_ids) as ids(id)
    ) then
      raise exception 'Destination file set changed; replacement was not performed' using errcode = '40001';
    end if;
    update public.cloud_project_files
      set state = 'cleanup', cleanup_owner_user_id = (select auth.uid())
      where project_id = staged.project_id
        and workspace_id = staged.workspace_id and state = 'ready';
    new_record := staged.staged_record || jsonb_build_object(
      'projectId', staged.project_id,
      'ownerUserId', project_row.owner_user_id,
      'workspaceId', project_row.workspace_id,
      'recordRevision', project_row.record_revision + 1,
      'createdAt', project_row.record->'createdAt'
    );
    update public.cloud_projects set record = new_record, record_revision = record_revision + 1,
      updated_at = now()
      where project_id = staged.project_id and workspace_id = staged.workspace_id
      returning * into project_row;
  end if;
  update public.cloud_project_files set state = 'ready', stage_id = null
    where stage_id = staged.stage_id;
  delete from public.cloud_project_restore_stages where stage_id = staged.stage_id;
  if staged.mode = 'new' then return project_row.record; end if;
  return project_row.record;
end;
$function$;
revoke all on function public.finalize_cloud_project_restore(uuid, text[]) from public, anon;
grant execute on function public.finalize_cloud_project_restore(uuid, text[]) to authenticated;

create or replace function public.begin_cloud_project_restore_abandon(p_stage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  staged public.cloud_project_restore_stages%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_stage_id::text));
  select * into staged from public.cloud_project_restore_stages
    where stage_id = p_stage_id;
  if not found then raise exception 'Restore stage not found' using errcode = 'P0002'; end if;
  if not (
    public.workspace_can(staged.workspace_id, 'replace')
    or (
      staged.owner_user_id = (select auth.uid())
      and public.workspace_can(
        staged.workspace_id,
        case when staged.mode = 'new' then 'restore-new' else 'replace' end
      )
    )
  ) then
    raise exception 'Caller cannot abandon this restore stage' using errcode = '42501';
  end if;
  if staged.state = 'open' then
    update public.cloud_project_restore_stages
      set state = 'abandoning'
      where stage_id = staged.stage_id;
  end if;
  return true;
end;
$function$;
revoke all on function public.begin_cloud_project_restore_abandon(uuid) from public, anon;
grant execute on function public.begin_cloud_project_restore_abandon(uuid) to authenticated;

create or replace function public.finish_cloud_project_restore_abandon(p_stage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  staged public.cloud_project_restore_stages%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_stage_id::text));
  select * into staged from public.cloud_project_restore_stages
    where stage_id = p_stage_id;
  if not found then raise exception 'Restore stage not found' using errcode = 'P0002'; end if;
  if staged.state <> 'abandoning' then
    raise exception 'Restore stage has not entered abandonment' using errcode = '40001';
  end if;
  if not (
    public.workspace_can(staged.workspace_id, 'replace')
    or (
      staged.owner_user_id = (select auth.uid())
      and public.workspace_can(
        staged.workspace_id,
        case when staged.mode = 'new' then 'restore-new' else 'replace' end
      )
    )
  ) then
    raise exception 'Caller cannot abandon this restore stage' using errcode = '42501';
  end if;
  if exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'project-files'
      and split_part(object.name, '/', 1) = staged.workspace_id::text
      and split_part(object.name, '/', 2) = '_staging'
      and split_part(object.name, '/', 3) = staged.stage_id::text
  ) then
    raise exception 'Staged Storage objects remain; remove them before completing abandonment'
      using errcode = '40001';
  end if;
  delete from public.cloud_project_files where stage_id = staged.stage_id;
  delete from public.cloud_project_restore_stages where stage_id = staged.stage_id;
  if staged.mode = 'new' then
    delete from public.cloud_projects
      where project_id = staged.project_id and workspace_id = staged.workspace_id
        and owner_user_id = staged.owner_user_id and status = 'staging';
  end if;
  return true;
end;
$function$;
revoke all on function public.finish_cloud_project_restore_abandon(uuid) from public, anon;
grant execute on function public.finish_cloud_project_restore_abandon(uuid) to authenticated;

-- Upload metadata is hidden in state=uploading until the private object exists.
create or replace function public.finish_cloud_project_file_upload(p_file_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  file_row public.cloud_project_files%rowtype;
begin
  select * into file_row from public.cloud_project_files
    where file_id = p_file_id and state = 'uploading';
  if not found or not public.workspace_can(file_row.workspace_id, 'write') then
    raise exception 'Uploading file not found or not writable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'project-files'
      and object.name = substring(file_row.storage_path from 15)
  ) then
    raise exception 'Uploaded Storage object is missing' using errcode = '40001';
  end if;
  update public.cloud_project_files set state = 'ready'
    where file_id = file_row.file_id and state = 'uploading';
  return jsonb_build_object(
    'fileId', file_row.file_id, 'projectId', file_row.project_id,
    'name', file_row.name, 'type', file_row.type, 'size', file_row.size,
    'uploadedAt', file_row.uploaded_at
  );
end;
$function$;
revoke all on function public.finish_cloud_project_file_upload(text) from public, anon;
grant execute on function public.finish_cloud_project_file_upload(text) to authenticated;

-- Metadata deletion is allowed only after the object is confirmed absent.
-- This makes object cleanup retryable without creating inaccessible orphans.
create or replace function public.delete_cloud_project_file_metadata(p_storage_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  file_row public.cloud_project_files%rowtype;
begin
  select * into file_row from public.cloud_project_files where storage_path = p_storage_path;
  if not found then return true; end if;
  if file_row.state = 'cleanup' then
    if not public.workspace_can(file_row.workspace_id, 'replace') then
      raise exception 'Replacement permission is required for cleanup' using errcode = '42501';
    end if;
  elsif file_row.state = 'staged' then
    if not exists (
      select 1 from public.cloud_project_restore_stages as stage
      where stage.stage_id = file_row.stage_id
        and stage.workspace_id = file_row.workspace_id
        and stage.owner_user_id = (select auth.uid())
        and public.workspace_can(
          stage.workspace_id,
          case when stage.mode = 'new' then 'restore-new' else 'replace' end
        )
    ) then
      raise exception 'Caller cannot remove staged file metadata' using errcode = '42501';
    end if;
  elsif file_row.state in ('ready', 'uploading') then
    if not public.workspace_can(file_row.workspace_id, 'write') then
      raise exception 'Write permission is required to remove a project file' using errcode = '42501';
    end if;
  else
    raise exception 'File metadata cannot be removed in its current state' using errcode = '42501';
  end if;
  if exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'project-files'
      and object.name = substring(file_row.storage_path from 15)
  ) then
    raise exception 'Storage object still exists; remove it before deleting metadata'
      using errcode = '40001';
  end if;
  delete from public.cloud_project_files where storage_path = p_storage_path;
  return true;
end;
$function$;
revoke all on function public.delete_cloud_project_file_metadata(text) from public, anon;
grant execute on function public.delete_cloud_project_file_metadata(text) to authenticated;

create table if not exists public.cloud_schema_versions (
  component text primary key,
  version integer not null
);
alter table public.cloud_schema_versions enable row level security;
revoke all on public.cloud_schema_versions from public, anon, authenticated;
grant select on public.cloud_schema_versions to authenticated;
drop policy if exists cloud_schema_versions_authenticated_read on public.cloud_schema_versions;
create policy cloud_schema_versions_authenticated_read on public.cloud_schema_versions
  for select to authenticated using (true);
insert into public.cloud_schema_versions (component, version)
values ('project-storage', 1) on conflict (component) do update set version = excluded.version;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists project_files_read_authorized on storage.objects;
create policy project_files_read_authorized on storage.objects
  for select to authenticated using (
    bucket_id = 'project-files'
    and exists (select 1 from public.cloud_project_files f
      where f.storage_path = 'project-files/' || storage.objects.name
        and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
        and (
          (f.state = 'ready' and public.workspace_can(f.workspace_id, 'read'))
          or (f.state = 'uploading' and public.workspace_can(f.workspace_id, 'write'))
          or (f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))
          or (f.state = 'staged' and exists (
            select 1 from public.cloud_project_restore_stages s
            where s.stage_id = f.stage_id
              and s.workspace_id = f.workspace_id
              and (s.owner_user_id = (select auth.uid())
                or public.workspace_can(s.workspace_id, 'replace'))
          ))
        ))
  );
drop policy if exists project_files_insert_authorized on storage.objects;
create policy project_files_insert_authorized on storage.objects
  for insert to authenticated with check (
    bucket_id = 'project-files'
    and (
      exists (select 1 from public.cloud_project_files f
        where f.storage_path = 'project-files/' || storage.objects.name
          and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and f.state = 'uploading'
          and public.workspace_can(f.workspace_id, 'write'))
      or exists (select 1 from public.cloud_project_files f
        join public.cloud_project_restore_stages s
          on s.stage_id = f.stage_id
         and s.workspace_id = f.workspace_id
         and s.project_id = f.project_id
        where f.storage_path = 'project-files/' || storage.objects.name
          and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and split_part(storage.objects.name, '/', 2) = '_staging'
          and s.stage_id::text = split_part(storage.objects.name, '/', 3)
          and f.file_id = split_part(storage.objects.name, '/', 4)
          and f.state = 'staged'
          and f.file_id = any(s.staged_file_ids)
           and s.state = 'open'
          and s.owner_user_id = (select auth.uid()))
    )
  );
drop policy if exists project_files_delete_authorized on storage.objects;
create policy project_files_delete_authorized on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-files'
    and exists (select 1 from public.cloud_project_files f
      where f.storage_path = 'project-files/' || storage.objects.name
        and (
          (f.state in ('ready', 'uploading') and public.workspace_can(f.workspace_id, 'write'))
          or (f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))
          or (f.state = 'staged' and exists (
            select 1 from public.cloud_project_restore_stages as stage
            where stage.stage_id = f.stage_id
              and stage.workspace_id = f.workspace_id
              and (stage.owner_user_id = (select auth.uid())
                or public.workspace_can(stage.workspace_id, 'replace'))
          ))
        ))
  );

comment on table public.cloud_projects is
  'Workspace-scoped project JSON. All content remains in JSONB without server-side schema rewriting; record revisions are atomically guarded.';
comment on table public.cloud_project_files is
  'Metadata for private project-files objects. Storage reads and writes are bound to active workspace roles.';