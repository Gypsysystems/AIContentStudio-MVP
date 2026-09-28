-- Focused SQL integration coverage. Run only against a disposable local
-- database named content_catalog_test_<hex>; never use a hosted Supabase URL.
\set ON_ERROR_STOP on

do $database_guard$
begin
  if current_database() !~ '^content_catalog_test_[0-9a-f]+$' then
    raise exception 'Content catalog SQL integration requires a disposable content_catalog_test_<hex> database';
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
insert into public.workspaces values ('10000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner');
insert into public.cloud_projects (
  project_id, workspace_id, owner_user_id, record_revision, record, status
) values (
  'backfill-project',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  11,
  '{"appToc":[{"id":41,"title":"Backfilled"}]}'::jsonb,
  'active'
);

\i supabase/migrations/20260927000200_content_catalog.sql

insert into public.cloud_projects (
  project_id, workspace_id, owner_user_id, record_revision, record, status
) values (
  'catalog-project',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  3,
  '{
    "appToc":[
      {"id":7,"title":"Legacy Topic"},
      {"id":8,"topicId":" stable-topic ","title":"Stable Topic","parentId":7}
    ],
    "topicContent":{
      "legacy-7":[{"type":"paragraph","text":"stable key wins","evidenceIds":["private-evidence"]}],
      "7":[{"type":"paragraph","text":"numeric legacy key"}],
      "8":[{"type":"paragraph","text":"numeric fallback","groundingContext":{"secret":"removed"},"sourceId":"source-a","sourceIds":["source-b"]}]
    },
    "snippets":[
      {"id":"snippet-ok","name":"Welcome","content":"Hello"},
      {"id":false,"name":"Malformed","content":"Skipped"},
      {"id":"snippet-second","name":"Second","content":"Still indexed"}
    ],
    "themeVariables":{"theme-a":[
      {"id":"accent","name":"Accent","value":"blue","description":"brand"},
      {"id":"variable-object","name":"Invalid value","value":{"unexpected":"object"}},
      {"id":"variable-missing","name":"Missing value"}
    ]},
    "projectMeta":{"themeId":"theme-a"},
    "conditionGroups":[
      {"id":"condition-a","group":"Audience","tags":["staff"]},
      {"id":"condition-bad-tags","group":"Invalid tags","tags":["staff",7]},
      {"id":"condition-missing-tags","group":"Missing tags"}
    ]
  }'::jsonb,
  'active'
);

-- These two logical identities collided under the old colon-concatenated UUID
-- scheme: project "project:topic"/snippet "same" and project "project"/topic
-- "snippet:same". Natural keys must keep their persisted UUIDs distinct.
insert into public.cloud_projects (
  project_id, workspace_id, owner_user_id, record_revision, record, status
) values
  ('project:topic', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 0,
   '{"snippets":[{"id":"same","name":"Colon snippet","content":"one"}]}'::jsonb, 'active'),
  ('project', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 0,
   '{"appToc":[{"id":5,"topicId":"snippet:same","title":"Colon topic"}]}'::jsonb, 'active');

create function public.content_catalog_test_fail_version_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.project_id = 'catalog-project'
    and current_setting('app.test_catalog_dml_failure', true) = 'on' then
    raise exception 'intentional catalog DML failure' using errcode = '23514';
  end if;
  return new;
end;
$function$;
create trigger content_catalog_test_fail_version_insert
  before insert on public.content_catalog_versions
  for each row execute function public.content_catalog_test_fail_version_insert();
create function public.content_catalog_test_nested_version_mutation()
returns trigger
language plpgsql
as $function$
begin
  if current_setting('app.test_nested_catalog_mutation', true) = 'delete' then
    delete from public.content_catalog_versions
    where item_id = (
      select item_id from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic'
        and local_asset_id = 'legacy-7'
    ) and version = 1;
  elsif current_setting('app.test_nested_catalog_mutation', true) = 'update' then
    update public.content_catalog_versions set payload = '{}'::jsonb
    where item_id = (
      select item_id from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic'
        and local_asset_id = 'legacy-7'
    ) and version = 1;
  end if;
  return new;
end;
$function$;
create trigger content_catalog_test_nested_version_mutation
  after update of record on public.cloud_projects
  for each row execute function public.content_catalog_test_nested_version_mutation();

do $checks$
declare
  legacy_item public.content_catalog_items%rowtype;
  stable_item public.content_catalog_items%rowtype;
  backfill_item_id uuid;
  colon_snippet_id uuid;
  colon_topic_id uuid;
  initial_version_count integer;
  topic_versions_before integer;
  caught boolean;
  local_id text;
begin
  select item_id into backfill_item_id from public.content_catalog_items
    where project_id = 'backfill-project' and asset_type = 'topic' and local_asset_id = 'legacy-41';
  if backfill_item_id is null or (
    select source_project_revision from public.content_catalog_versions
    where item_id = backfill_item_id and version = 1
  ) <> 11 then
    raise exception 'Existing active project was not deterministically backfilled';
  end if;
  if (select payload->'blocks' from public.content_catalog_versions
      where item_id = backfill_item_id and version = 1) <> '[]'::jsonb then
    raise exception 'Missing topicContent did not normalize as an unauthored empty block list';
  end if;
  perform public.sync_cloud_project_content_catalog(
    '10000000-0000-0000-0000-000000000001', 'backfill-project',
    '{"appToc":[{"id":41,"title":"Backfilled"}]}'::jsonb,
    11, 'active'
  );
  if (select count(*) from public.content_catalog_versions where item_id = backfill_item_id) <> 1
    or (select item_id from public.content_catalog_items where item_id = backfill_item_id) is null then
    raise exception 'Deterministic backfill rerun created a duplicate version or ID';
  end if;
  perform public.content_catalog_sync_asset(
    '10000000-0000-0000-0000-000000000001', 'backfill-project', 11, 'topic',
    'legacy-41', 'Metadata-only rename',
    (select payload from public.content_catalog_versions where item_id = backfill_item_id and version = 1)
  );
  if (select current_version from public.content_catalog_items where item_id = backfill_item_id) <> 1
    or (select display_name from public.content_catalog_items where item_id = backfill_item_id)
      <> 'Metadata-only rename' then
    raise exception 'Metadata-only display-name update created a payload version';
  end if;

  select item_id into colon_snippet_id from public.content_catalog_items
    where project_id = 'project:topic' and asset_type = 'snippet' and local_asset_id = 'same';
  select item_id into colon_topic_id from public.content_catalog_items
    where project_id = 'project' and asset_type = 'topic' and local_asset_id = 'snippet:same';
  if colon_snippet_id is null or colon_topic_id is null or colon_snippet_id = colon_topic_id then
    raise exception 'Colon-containing natural identities collided or did not persist distinct UUIDs';
  end if;

  select * into legacy_item from public.content_catalog_items
    where project_id = 'catalog-project' and asset_type = 'topic' and local_asset_id = 'legacy-7';
  if not found then raise exception 'Topic without topicId did not use legacy-<id> stable identity'; end if;
  if legacy_item.display_name <> 'Legacy Topic' then raise exception 'Legacy topic display name missing'; end if;
  if (select payload->>'title' from public.content_catalog_versions
      where item_id = legacy_item.item_id and version = 1) <> 'Legacy Topic'
    or (select payload->'blocks'->0->>'text' from public.content_catalog_versions
      where item_id = legacy_item.item_id and version = 1) <> 'stable key wins' then
    raise exception 'Topic stable-key content lookup or normalized payload failed';
  end if;
  if (select payload->'blocks'->0 ? 'evidenceIds' from public.content_catalog_versions
      where item_id = legacy_item.item_id and version = 1) then
    raise exception 'Topic evidence identifiers were retained in the catalog';
  end if;
  if legacy_item.current_hash <> encode(sha256(convert_to(
      (select payload::text from public.content_catalog_versions
       where item_id = legacy_item.item_id and version = 1), 'UTF8')), 'hex') then
    raise exception 'Current content fingerprint is not the SHA-256 of canonical payload JSON';
  end if;

  select * into stable_item from public.content_catalog_items
    where project_id = 'catalog-project' and asset_type = 'topic' and local_asset_id = 'stable-topic';
  if not found then raise exception 'Trimmed non-empty topicId was not used as the stable identity'; end if;
  if (select payload->'parentId' from public.content_catalog_versions
      where item_id = stable_item.item_id and version = 1) <> '"legacy-7"'::jsonb then
    raise exception 'Parent topic identity did not use the matching stable identity';
  end if;
  if (select payload->'blocks'->0->>'text' from public.content_catalog_versions
      where item_id = stable_item.item_id and version = 1) <> 'numeric fallback' then
    raise exception 'Topic content did not fall back from stable ID to the legacy numeric key';
  end if;
  if (select payload->'blocks'->0 ? 'groundingContext' from public.content_catalog_versions
      where item_id = stable_item.item_id and version = 1) then
    raise exception 'Topic grounding metadata was retained in the catalog';
  end if;
  if (select payload->'blocks'->0 ? 'sourceId' or payload->'blocks'->0 ? 'sourceIds'
      from public.content_catalog_versions
      where item_id = stable_item.item_id and version = 1) then
    raise exception 'Topic source provenance identifiers were retained in the catalog';
  end if;
  if (select count(*) from public.content_catalog_items
      where project_id = 'catalog-project') <> 6 then
    raise exception 'Expected two topics, two snippets, one variable and one condition catalog items';
  end if;
  if exists (select 1 from public.content_catalog_items
      where project_id = 'catalog-project'
        and local_asset_id in (
          'variable-object', 'variable-missing', 'condition-bad-tags', 'condition-missing-tags'
        )) then
    raise exception 'Malformed variable value or condition tags were cataloged';
  end if;

  select count(*) into initial_version_count from public.content_catalog_versions;
  -- Irrelevant JSON record keys and revision changes do not reparse/index content.
  update public.cloud_projects set record_revision = record_revision + 1,
    record = record || '{"unrelated":{"changed":true}}'::jsonb
    where project_id = 'catalog-project';
  if (select count(*) from public.content_catalog_versions) <> initial_version_count then
    raise exception 'Unrelated project save created catalog versions';
  end if;

  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{snippets,0,content}', '"Hello again"'::jsonb)
    where project_id = 'catalog-project';
  if (select current_version from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'snippet'
        and local_asset_id = 'snippet-ok') <> 2 then
    raise exception 'Changed normalized snippet payload did not create exactly one revision';
  end if;
  perform set_config('app.test_catalog_dml_failure', 'on', true);
  caught := false;
  begin
    update public.cloud_projects set record_revision = record_revision + 1,
      record = jsonb_set(record, '{snippets,0,content}', '"must roll back"'::jsonb)
      where project_id = 'catalog-project';
  exception when check_violation then caught := true;
  end;
  perform set_config('app.test_catalog_dml_failure', 'off', true);
  if not caught
    or (select record #>> '{snippets,0,content}' from public.cloud_projects
        where project_id = 'catalog-project') <> 'Hello again'
    or (select current_version from public.content_catalog_items
        where project_id = 'catalog-project' and asset_type = 'snippet'
          and local_asset_id = 'snippet-ok') <> 2 then
    raise exception 'Catalog DML failure was swallowed instead of rolling back project update';
  end if;

  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{snippets}',
      '[{"id":"snippet-ok","name":"Welcome","content":"Hello again"}]'::jsonb)
    where project_id = 'catalog-project';
  if (select status from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'snippet'
        and local_asset_id = 'snippet-second') <> 'retired'
    or (select count(*) from public.content_catalog_versions version_row
      join public.content_catalog_items item using (item_id)
      where item.project_id = 'catalog-project' and item.local_asset_id = 'snippet-second') <> 1 then
    raise exception 'Removed asset did not retire while preserving its immutable version';
  end if;
  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{snippets}', jsonb_build_array(jsonb_build_object(
      'id', 'snippet-ok', 'name', 'Welcome', 'content', repeat('x', 60001)
    )))
    where project_id = 'catalog-project';
  if (select status from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'snippet'
        and local_asset_id = 'snippet-ok') <> 'retired'
    or (select count(*) from public.content_catalog_versions version_row
      join public.content_catalog_items item using (item_id)
      where item.project_id = 'catalog-project' and item.local_asset_id = 'snippet-ok') <> 2 then
    raise exception 'Malformed oversized asset remained active or lost its version history';
  end if;

  select count(*) into topic_versions_before from public.content_catalog_versions version_row
    join public.content_catalog_items item using (item_id)
    where item.project_id = 'catalog-project' and item.asset_type = 'topic';
  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{topicContent}', '[]'::jsonb)
    where project_id = 'catalog-project';
  if exists (select 1 from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic' and status = 'active')
    or (select count(*) from public.content_catalog_versions version_row
      join public.content_catalog_items item using (item_id)
      where item.project_id = 'catalog-project' and item.asset_type = 'topic')
      <> topic_versions_before then
    raise exception 'Wrong-shaped topicContent was indexed or left topics active';
  end if;

  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{topicContent}',
      '{"legacy-7":[{"type":"paragraph","text":"restored"}],"7":[{"text":"legacy"}],"8":[{"type":"paragraph","text":"numeric fallback","groundingContext":{"secret":"removed"},"sourceId":"source-a","sourceIds":["source-b"]}]}'::jsonb)
    where project_id = 'catalog-project';
  select count(*) into topic_versions_before from public.content_catalog_versions version_row
    join public.content_catalog_items item using (item_id)
    where item.project_id = 'catalog-project' and item.asset_type = 'topic';
  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{topicContent}',
      '{"legacy-7":"not-an-array","7":[{"text":"legacy fallback must not win"}],"8":[{"type":"paragraph","text":"numeric fallback","groundingContext":{"secret":"removed"},"sourceId":"source-a","sourceIds":["source-b"]}]}'::jsonb)
    where project_id = 'catalog-project';
  if (select status from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic'
        and local_asset_id = 'legacy-7') <> 'retired'
    or (select status from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic'
        and local_asset_id = 'stable-topic') <> 'active'
    or (select count(*) from public.content_catalog_versions version_row
      join public.content_catalog_items item using (item_id)
      where item.project_id = 'catalog-project' and item.asset_type = 'topic')
      <> topic_versions_before then
    raise exception 'Malformed per-topic block value was indexed or prevented a valid topic sync';
  end if;

  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{appToc}', (
      select jsonb_agg(jsonb_build_object('id', topic_number, 'title', 'Bulk topic ' || topic_number)
        order by topic_number)
      from generate_series(1, 1001) as generated(topic_number)
    ))
    where project_id = 'catalog-project';
  if exists (select 1 from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic' and status = 'active')
    or (select count(*) from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'topic') <> 2 then
    raise exception 'Oversized topic array was partially indexed or left stale topics active';
  end if;

  update public.cloud_projects set record_revision = record_revision + 1,
    record = jsonb_set(record, '{snippets}', (
      select jsonb_agg(jsonb_build_object('id', 'bulk-' || snippet_number,
        'name', 'Bulk snippet', 'content', 'text') order by snippet_number)
      from generate_series(1, 1001) as generated(snippet_number)
    ))
    where project_id = 'catalog-project';
  if exists (select 1 from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'snippet' and status = 'active')
    or (select count(*) from public.content_catalog_items
      where project_id = 'catalog-project' and asset_type = 'snippet') <> 2 then
    raise exception 'Oversized snippet array was partially indexed or left stale snippets active';
  end if;

  caught := false;
  begin
    update public.content_catalog_versions set payload = '{}'::jsonb
      where item_id = legacy_item.item_id and version = 1;
  exception when sqlstate '42501' then caught := true;
  end;
  if not caught then raise exception 'Version update was not rejected as immutable'; end if;
  caught := false;
  begin
    delete from public.content_catalog_versions
      where item_id = legacy_item.item_id and version = 1;
  exception when sqlstate '42501' then caught := true;
  end;
  if not caught then raise exception 'Version delete was not rejected as immutable'; end if;
  foreach local_id in array array['delete', 'update'] loop
    perform set_config('app.test_nested_catalog_mutation', local_id, true);
    caught := false;
    begin
      update public.cloud_projects set record = record || '{"nestedMutationProbe":true}'::jsonb
        where project_id = 'catalog-project';
    exception when insufficient_privilege then caught := true;
    end;
    if not caught then
      raise exception 'Nested % of a catalog version was not rejected', local_id;
    end if;
  end loop;
  perform set_config('app.test_nested_catalog_mutation', 'off', true);

  -- Staging rows are intentionally never cataloged.
  insert into public.cloud_projects (
    project_id, workspace_id, owner_user_id, record_revision, record, status
  ) values (
    'staging-project', '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 0,
    '{"appToc":[{"id":1,"title":"Must not be indexed"}]}'::jsonb, 'staging'
  );
  if exists (select 1 from public.content_catalog_items where project_id = 'staging-project') then
    raise exception 'Staging project was cataloged';
  end if;
end;
$checks$;
drop trigger content_catalog_test_fail_version_insert on public.content_catalog_versions;
drop function public.content_catalog_test_fail_version_insert();
drop trigger content_catalog_test_nested_version_mutation on public.cloud_projects;
drop function public.content_catalog_test_nested_version_mutation();

delete from public.cloud_projects where project_id = 'backfill-project';
do $cascade_check$
begin
  if exists (select 1 from public.content_catalog_items where project_id = 'backfill-project')
    or exists (select 1 from public.content_catalog_versions where project_id = 'backfill-project') then
    raise exception 'Catalog rows did not cascade with cloud-project deletion';
  end if;
end;
$cascade_check$;

set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
do $client_permissions$
declare
  caught boolean := false;
begin
  if (select count(*) from public.content_catalog_items where project_id = 'catalog-project') <> 6
    or (select count(*) from public.content_catalog_versions where project_id = 'catalog-project') < 7 then
    raise exception 'Authorized catalog reader could not see active project content';
  end if;
  begin
    insert into public.content_catalog_versions (
      item_id, version, workspace_id, project_id, content_hash, payload, source_project_revision
    ) values (
      gen_random_uuid(), 1, '10000000-0000-0000-0000-000000000001',
      'catalog-project', repeat('0', 64), '{}'::jsonb, 0
    );
  exception when insufficient_privilege then caught := true;
  end;
  if not caught then raise exception 'Authenticated client could directly write catalog versions'; end if;
  caught := false;
  begin
    update public.content_catalog_items set display_name = 'forged'
      where project_id = 'catalog-project';
  exception when insufficient_privilege then caught := true;
  end;
  if not caught then raise exception 'Authenticated client could directly update catalog items'; end if;
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000099', true);
  if exists (select 1 from public.content_catalog_items where project_id = 'catalog-project')
    or exists (select 1 from public.content_catalog_versions where project_id = 'catalog-project') then
    raise exception 'Catalog reader without same-workspace permission saw project content';
  end if;
end;
$client_permissions$;
reset role;
update public.cloud_projects set status = 'staging'
  where project_id = 'catalog-project';
set role authenticated;
do $hidden_staging$
begin
  if exists (select 1 from public.content_catalog_items where project_id = 'catalog-project')
    or exists (select 1 from public.content_catalog_versions where project_id = 'catalog-project') then
    raise exception 'Catalog rows remained visible after the project left active status';
  end if;
end;
$hidden_staging$;

reset role;
do $multi_item_cascade_precheck$
begin
  if (select count(*) from public.content_catalog_items where project_id = 'catalog-project') < 3
    or (select count(*) from public.content_catalog_versions where project_id = 'catalog-project') < 3 then
    raise exception 'Multi-item cascade fixture does not contain sufficient catalog history';
  end if;
end;
$multi_item_cascade_precheck$;
delete from public.cloud_projects where project_id = 'catalog-project';
do $multi_item_cascade_check$
begin
  if exists (select 1 from public.content_catalog_items where project_id = 'catalog-project')
    or exists (select 1 from public.content_catalog_versions where project_id = 'catalog-project') then
    raise exception 'Multi-item project cascade left catalog rows or immutable versions behind';
  end if;
end;
$multi_item_cascade_check$;