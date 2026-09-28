-- Focused lineage integration. psql must connect to a disposable local
-- Unix-socket database named content_catalog_test_<hex>; hosted DBs are refused.
\set ON_ERROR_STOP on

do $database_guard$
begin
  if current_database() !~ '^content_catalog_test_[0-9a-f]+$'
    or inet_client_addr() is not null then
    raise exception 'Content catalog lineage SQL integration requires a disposable local Unix-socket content_catalog_test_<hex> database';
  end if;
end;
$database_guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then execute 'create role anon'; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'create role authenticated'; end if;
end;
$roles$;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid()
returns uuid
language sql stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;
create table public.workspaces (id uuid primary key);
create table public.workspace_memberships (
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null
);
create table public.workspace_role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);
create table public.cloud_schema_versions (component text primary key, version integer not null);
create function public.workspace_can(p_workspace_id uuid, p_permission text)
returns boolean
language sql stable security invoker
as $function$
  select exists (
    select 1
    from public.workspace_memberships membership
    join public.workspace_role_permissions permission
      on permission.role = membership.role and permission.permission = p_permission
    where membership.workspace_id = p_workspace_id and membership.user_id = (select auth.uid())
  );
$function$;
revoke all on function public.workspace_can(uuid, text) from public, anon;
grant execute on function public.workspace_can(uuid, text) to authenticated;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.workspace_memberships, public.workspace_role_permissions to authenticated;
insert into public.workspace_role_permissions values ('owner', 'read');

create table public.cloud_projects (
  project_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  record_revision bigint not null default 0,
  record jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, project_id)
);
grant select on public.cloud_projects to authenticated;

insert into auth.users values ('20000000-0000-0000-0000-000000000001');
insert into public.workspaces values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into public.workspace_memberships values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner');

insert into public.cloud_projects (
  project_id, workspace_id, owner_user_id, record_revision, record, status
) values
  ('source-project', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 1,
   '{
     "appToc":[{"id":1,"topicId":"source-topic","title":"Source topic"}],
     "topicContent":{"source-topic":[{"type":"paragraph","text":"Source"}]},
     "snippets":[{"id":"source-snippet","name":"Source snippet","content":"source"}],
     "projectMeta":{"themeId":"source-theme"},
     "themeVariables":{"source-theme":[{"id":"source-variable","name":"Source variable","value":"blue"}]},
     "conditionGroups":[{"id":"source-condition","group":"Source condition","tags":[]}]
   }'::jsonb, 'active'),
  ('destination-project', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 1,
   '{
     "appToc":[{"id":2,"topicId":"destination-topic","title":"Destination topic"}],
     "topicContent":{"destination-topic":[{"type":"paragraph","text":"Destination"}]},
     "snippets":[{"id":"destination-snippet","name":"Destination snippet","content":"destination"}],
     "projectMeta":{"themeId":"destination-theme"},
     "themeVariables":{"destination-theme":[{"id":"destination-variable","name":"Destination variable","value":"green"}]},
     "conditionGroups":[{"id":"destination-condition","group":"Destination condition","tags":[]}]
   }'::jsonb, 'active'),
  ('foreign-source', '10000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000001', 1,
   '{"snippets":[{"id":"foreign-snippet","name":"Foreign snippet","content":"foreign"}]}'::jsonb,
   'active'),
  ('deleting-source', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 1,
   '{"appToc":[{"id":4,"topicId":"deleting-source-topic","title":"Deleting source"}]}'::jsonb,
   'active'),
  ('deleting-destination', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 1,
   '{"appToc":[{"id":5,"topicId":"deleting-destination-topic","title":"Deleting destination"}]}'::jsonb,
   'active');

\i supabase/migrations/20260927000200_content_catalog.sql

-- Simulate an already-saved lineage record that the additive migration must
-- validate while backfilling, rather than requiring a new project save.
do $prepare_backfill$
declare
  source_topic uuid;
  source_snippet uuid;
  source_variable uuid;
  source_condition uuid;
  deleting_source_topic uuid;
begin
  select item_id into source_topic from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'topic' and local_asset_id = 'source-topic';
  select item_id into source_snippet from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'snippet' and local_asset_id = 'source-snippet';
  select item_id into source_variable from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'variable' and local_asset_id = 'source-variable';
  select item_id into source_condition from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'condition' and local_asset_id = 'source-condition';
  select item_id into deleting_source_topic from public.content_catalog_items
    where project_id = 'deleting-source' and asset_type = 'topic' and local_asset_id = 'deleting-source-topic';

  update public.cloud_projects set record = record || jsonb_build_object(
    'contentOrigins', jsonb_build_object(
      'topic', jsonb_build_object('destination-topic', jsonb_build_object(
        'originItemId', source_topic::text, 'originProjectId', 'source-project', 'originVersion', 1)),
      'snippet', jsonb_build_object('destination-snippet', jsonb_build_object(
        'originItemId', source_snippet::text, 'originProjectId', 'source-project', 'originVersion', 1)),
      'variable', jsonb_build_object('destination-variable', jsonb_build_object(
        'originItemId', source_variable::text, 'originProjectId', 'source-project', 'originVersion', 1)),
      'condition', jsonb_build_object('destination-condition', jsonb_build_object(
        'originItemId', source_condition::text, 'originProjectId', 'source-project', 'originVersion', 1))
    )
  )
  where project_id = 'destination-project';

  update public.cloud_projects set record = record || jsonb_build_object(
    'contentOrigins', jsonb_build_object(
      'topic', jsonb_build_object('deleting-destination-topic', jsonb_build_object(
        'originItemId', deleting_source_topic::text,
        'originProjectId', 'deleting-source',
        'originVersion', 1
      ))
    )
  ) where project_id = 'deleting-destination';
  update public.cloud_projects set status = 'deleting'
    where project_id = 'deleting-source';
end;
$prepare_backfill$;

\i supabase/migrations/20260928000100_content_catalog_lineage.sql

-- INSERT must also run catalog creation first, then resolve against its rows.
insert into public.cloud_projects (
  project_id, workspace_id, owner_user_id, record_revision, record, status
)
select
  'insert-destination', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 1,
  jsonb_build_object(
    'appToc', jsonb_build_array(jsonb_build_object(
      'id', 3, 'topicId', 'insert-topic', 'title', 'Inserted destination')),
    'topicContent', jsonb_build_object(
      'insert-topic', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'text', 'Inserted'))),
    'contentOrigins', jsonb_build_object(
      'topic', jsonb_build_object('insert-topic', jsonb_build_object(
        'originItemId', (
          select item_id::text from public.content_catalog_items
          where project_id = 'source-project' and asset_type = 'topic' and local_asset_id = 'source-topic'
        ),
        'originProjectId', 'source-project',
        'originVersion', 1
      ))
    )
  ),
  'active';

do $lineage_checks$
declare
  source_topic uuid;
  source_snippet uuid;
  source_variable uuid;
  source_condition uuid;
  foreign_snippet uuid;
  destination_topic uuid;
  destination_snippet uuid;
  destination_variable uuid;
  destination_condition uuid;
  inserted_topic uuid;
  deleting_destination_topic uuid;
  versions_before integer;
begin
  if (select version from public.cloud_schema_versions where component = 'content-catalog') <> 2 then
    raise exception 'Content catalog schema marker was not advanced to version 2';
  end if;

  select item_id into source_topic from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'topic' and local_asset_id = 'source-topic';
  select item_id into source_snippet from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'snippet' and local_asset_id = 'source-snippet';
  select item_id into source_variable from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'variable' and local_asset_id = 'source-variable';
  select item_id into source_condition from public.content_catalog_items
    where project_id = 'source-project' and asset_type = 'condition' and local_asset_id = 'source-condition';
  select item_id into foreign_snippet from public.content_catalog_items
    where project_id = 'foreign-source' and asset_type = 'snippet' and local_asset_id = 'foreign-snippet';
  select item_id into destination_topic from public.content_catalog_items
    where project_id = 'destination-project' and asset_type = 'topic' and local_asset_id = 'destination-topic';
  select item_id into destination_snippet from public.content_catalog_items
    where project_id = 'destination-project' and asset_type = 'snippet' and local_asset_id = 'destination-snippet';
  select item_id into destination_variable from public.content_catalog_items
    where project_id = 'destination-project' and asset_type = 'variable' and local_asset_id = 'destination-variable';
  select item_id into destination_condition from public.content_catalog_items
    where project_id = 'destination-project' and asset_type = 'condition' and local_asset_id = 'destination-condition';
  select item_id into inserted_topic from public.content_catalog_items
    where project_id = 'insert-destination' and asset_type = 'topic' and local_asset_id = 'insert-topic';
  select item_id into deleting_destination_topic from public.content_catalog_items
    where project_id = 'deleting-destination' and asset_type = 'topic'
      and local_asset_id = 'deleting-destination-topic';

  if (select (origin_item_id, origin_project_id, origin_version)
      from public.content_catalog_items where item_id = destination_topic)
      is distinct from (source_topic, 'source-project'::text, 1)
    or (select (origin_item_id, origin_project_id, origin_version)
      from public.content_catalog_items where item_id = destination_snippet)
      is distinct from (source_snippet, 'source-project'::text, 1)
    or (select (origin_item_id, origin_project_id, origin_version)
      from public.content_catalog_items where item_id = destination_variable)
      is distinct from (source_variable, 'source-project'::text, 1)
    or (select (origin_item_id, origin_project_id, origin_version)
      from public.content_catalog_items where item_id = destination_condition)
      is distinct from (source_condition, 'source-project'::text, 1) then
    raise exception 'Active-record backfill failed to resolve all valid same-workspace content origins';
  end if;
  if (select origin_item_id from public.content_catalog_items where item_id = inserted_topic)
      is distinct from source_topic
    or (select origin_project_id from public.content_catalog_items where item_id = inserted_topic)
      is distinct from 'source-project'
    or (select origin_version from public.content_catalog_items where item_id = inserted_topic) <> 1 then
    raise exception 'INSERT lineage trigger did not run after v1 catalog synchronization';
  end if;
  if (select origin_item_id from public.content_catalog_items where item_id = deleting_destination_topic)
      is not null then
    raise exception 'Backfill linked to a source project already marked deleting';
  end if;

  if exists (
    select 1 from public.content_catalog_items
    where project_id in ('source-project', 'destination-project', 'insert-destination')
      and current_version <> 1
  ) or exists (
    select 1 from public.content_catalog_versions
    where project_id in ('source-project', 'destination-project', 'insert-destination')
    group by item_id having count(*) <> 1
  ) then
    raise exception 'Lineage metadata created false content versions';
  end if;

  select count(*) into versions_before from public.content_catalog_versions;
  -- Poison one current pointer, then make an unrelated project save. If the
  -- lineage function is unnecessarily run, its valid record metadata repairs
  -- the pointer; the WHEN filter must leave it untouched and add no version.
  update public.content_catalog_items set
    origin_item_id = destination_topic,
    origin_project_id = 'destination-project',
    origin_version = 1
  where item_id = destination_topic;
  update public.cloud_projects set record = record || '{"unrelatedLineageProbe":true}'::jsonb
    where project_id = 'destination-project';
  if (select origin_item_id from public.content_catalog_items where item_id = destination_topic)
      is distinct from destination_topic
    or (select count(*) from public.content_catalog_versions) <> versions_before then
    raise exception 'Unrelated project save ran lineage synchronization or created a content version';
  end if;

  update public.cloud_projects set record = record || jsonb_build_object(
    'contentOrigins', jsonb_build_object(
      'topic', jsonb_build_object('destination-topic', jsonb_build_object(
        'originItemId', destination_topic::text, 'originProjectId', 'destination-project', 'originVersion', 1)),
      'snippet', jsonb_build_object('destination-snippet', jsonb_build_object(
        'originItemId', source_snippet::text, 'originProjectId', 'source-project', 'originVersion', 2)),
      'variable', jsonb_build_object('destination-variable', jsonb_build_object(
        'originItemId', source_variable::text, 'originProjectId', 'foreign-source', 'originVersion', 1)),
      'condition', jsonb_build_object('destination-condition', jsonb_build_object(
        'originItemId', foreign_snippet::text, 'originProjectId', 'foreign-source', 'originVersion', 1))
    )
  )
  where project_id = 'destination-project';

  if exists (
    select 1 from public.content_catalog_items
    where item_id in (destination_topic, destination_snippet, destination_variable, destination_condition)
      and (origin_item_id is not null or origin_project_id is not null or origin_version is not null)
  ) then
    raise exception 'Self, nonexistent exact version, mismatched project, or cross-workspace origin was linked';
  end if;
  if (select count(*) from public.content_catalog_versions) <> versions_before then
    raise exception 'Lineage-only invalid references created content catalog versions';
  end if;

  -- Malformed optional metadata, including an oversized integer, must clear
  -- prior values without raising or changing the content history.
  update public.cloud_projects set record = record || jsonb_build_object(
    'contentOrigins', jsonb_build_object(
      'topic', jsonb_build_object('destination-topic', 'not-an-origin'),
      'snippet', jsonb_build_object('destination-snippet', jsonb_build_object(
        'originItemId', 'not-a-uuid', 'originProjectId', 'source-project', 'originVersion', 9999999999)),
      'variable', jsonb_build_array('malformed'),
      'condition', false
    )
  ) where project_id = 'destination-project';
  if exists (
    select 1 from public.content_catalog_items
    where item_id in (destination_topic, destination_snippet, destination_variable, destination_condition)
      and (origin_item_id is not null or origin_project_id is not null or origin_version is not null)
  ) or (select count(*) from public.content_catalog_versions) <> versions_before then
    raise exception 'Malformed optional contentOrigins did not safely clear lineage without versions';
  end if;

  -- Non-active destination projects are skipped; reactivation invokes lineage
  -- synchronization after v1's catalog work.
  update public.cloud_projects set status = 'staging',
    record = record || jsonb_build_object(
      'contentOrigins', jsonb_build_object(
        'topic', jsonb_build_object('destination-topic', jsonb_build_object(
          'originItemId', source_topic::text, 'originProjectId', 'source-project', 'originVersion', 1))
      )
    )
  where project_id = 'destination-project';
  if (select origin_item_id from public.content_catalog_items where item_id = destination_topic)
      is not null then
    raise exception 'Staging destination unexpectedly synchronized lineage';
  end if;
  update public.cloud_projects set status = 'active'
    where project_id = 'destination-project';
  if (select origin_item_id from public.content_catalog_items where item_id = destination_topic)
      is distinct from source_topic then
    raise exception 'Reactivation did not synchronize valid lineage after v1';
  end if;

  -- Removing the destination asset and its origin retires the item, clears its
  -- lineage, and preserves its immutable content version.
  update public.cloud_projects set status = 'active',
    record = jsonb_set(
      jsonb_set(record - 'contentOrigins', '{appToc}', '[]'::jsonb),
      '{topicContent}', '{}'::jsonb
    )
  where project_id = 'destination-project';
  if (select status from public.content_catalog_items where item_id = destination_topic) <> 'retired'
    or (select origin_item_id from public.content_catalog_items where item_id = destination_topic) is not null
    or (select count(*) from public.content_catalog_versions where item_id = destination_topic) <> 1 then
    raise exception 'Retiring a destination did not clear lineage while preserving immutable history';
  end if;
end;
$lineage_checks$;

-- Source-project cascade must not delete the destination or leave an active
-- pointer to an origin that no longer exists.
delete from public.cloud_projects where project_id = 'source-project';
do $source_delete_check$
begin
  if not exists (
    select 1 from public.cloud_projects where project_id = 'insert-destination'
  ) or not exists (
    select 1 from public.content_catalog_items
    where project_id = 'insert-destination' and asset_type = 'topic'
      and local_asset_id = 'insert-topic' and status = 'active'
      and origin_item_id is null and origin_project_id is null and origin_version is null
  ) or exists (
    select 1 from public.content_catalog_items
    where project_id = 'source-project'
  ) or exists (
    select 1 from public.content_catalog_versions
    where project_id = 'source-project'
  ) then
    raise exception 'Deleting the source project removed its destination or left an orphan lineage pointer';
  end if;
end;
$source_delete_check$;