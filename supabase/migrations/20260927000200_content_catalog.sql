-- A project-local, append-only catalog of authored content. Catalog rows are
-- derived from cloud_projects.record; callers never write catalog data directly.

create table if not exists public.content_catalog_items (
  item_id uuid primary key,
  workspace_id uuid not null,
  project_id text not null,
  asset_type text not null check (asset_type in (
    'topic', 'snippet', 'variable', 'condition', 'reference', 'media'
  )),
  local_asset_id text not null check (char_length(local_asset_id) between 1 and 512),
  display_name text not null check (char_length(display_name) between 1 and 500),
  status text not null check (status in ('active', 'retired')),
  current_version integer not null check (current_version > 0),
  current_hash text not null check (current_hash ~ '^[0-9a-f]{64}$'),
  origin_item_id uuid,
  origin_project_id text,
  origin_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, workspace_id, project_id),
  unique (workspace_id, project_id, asset_type, local_asset_id),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade
);

create table if not exists public.content_catalog_versions (
  item_id uuid not null,
  version integer not null check (version > 0),
  workspace_id uuid not null,
  project_id text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_project_revision bigint not null check (source_project_revision >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (item_id, version),
  foreign key (item_id, workspace_id, project_id)
    references public.content_catalog_items(item_id, workspace_id, project_id) on delete cascade
);

create index if not exists content_catalog_items_workspace_project_type
  on public.content_catalog_items (workspace_id, project_id, asset_type);
create index if not exists content_catalog_items_workspace_name
  on public.content_catalog_items (workspace_id, display_name);
create index if not exists content_catalog_items_current
  on public.content_catalog_items (workspace_id, project_id, status, current_version);
create index if not exists content_catalog_versions_workspace_project
  on public.content_catalog_versions (workspace_id, project_id, item_id, version desc);

alter table public.content_catalog_items enable row level security;
alter table public.content_catalog_versions enable row level security;
revoke all on public.content_catalog_items, public.content_catalog_versions
  from public, anon, authenticated;
grant select on public.content_catalog_items, public.content_catalog_versions to authenticated;

drop policy if exists content_catalog_items_read_workspace on public.content_catalog_items;
create policy content_catalog_items_read_workspace on public.content_catalog_items
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and exists (
      select 1 from public.cloud_projects as project
      where project.workspace_id = content_catalog_items.workspace_id
        and project.project_id = content_catalog_items.project_id
        and project.status = 'active'
    )
  );
drop policy if exists content_catalog_versions_read_workspace on public.content_catalog_versions;
create policy content_catalog_versions_read_workspace on public.content_catalog_versions
  for select to authenticated using (
    public.workspace_can(workspace_id, 'read')
    and exists (
      select 1 from public.cloud_projects as project
      where project.workspace_id = content_catalog_versions.workspace_id
        and project.project_id = content_catalog_versions.project_id
        and project.status = 'active'
    )
  );

-- Strip authoring/evidence metadata at every nesting level before topic blocks
-- enter the searchable catalog. Bound recursion so pathological JSON skips just
-- the affected asset rather than making a project save fail.
create or replace function public.content_catalog_clean_json(p_value jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result jsonb;
  pair record;
begin
  if p_depth > 32 then
    raise exception 'Catalog payload nesting exceeds its limit' using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) = 'object' then
    result := '{}'::jsonb;
    for pair in select key, value from jsonb_each(p_value) loop
      if pair.key ~* '(evidence.?ids?|source.?ids?|source.?file.?ids?|source.?paths?|grounding|provenance|author.?topic.?metadata|regeneration.?proposal|applied.?baseline|block.?states)' then
        continue;
      end if;
      result := result || jsonb_build_object(
        pair.key, public.content_catalog_clean_json(pair.value, p_depth + 1)
      );
    end loop;
    return result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(
      public.content_catalog_clean_json(array_part.value, p_depth + 1) order by array_part.ordinality
    ), '[]'::jsonb)
    into result
    from jsonb_array_elements(p_value) with ordinality as array_part(value, ordinality);
    return result;
  end if;
  return p_value;
end;
$function$;
revoke all on function public.content_catalog_clean_json(jsonb, integer) from public, anon, authenticated;

-- Kept separate from normalization so storage failures abort the project save.
-- jsonb::text has canonical object-key order for stable SHA-256 fingerprints.
create or replace function public.content_catalog_sync_asset(
  p_workspace_id uuid,
  p_project_id text,
  p_record_revision bigint,
  p_asset_type text,
  p_local_asset_id text,
  p_display_name text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset_uuid uuid;
  payload_hash text;
  catalog_item public.content_catalog_items%rowtype;
  next_version integer;
begin
  if p_asset_type not in ('topic', 'snippet', 'variable', 'condition', 'reference', 'media')
    or p_local_asset_id is null or char_length(p_local_asset_id) not between 1 and 512
    or p_display_name is null or char_length(p_display_name) not between 1 and 500
    or btrim(p_display_name) = ''
    or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(convert_to(p_payload::text, 'UTF8')) > 65536 then
    return null;
  end if;
  payload_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text), hashtext(p_project_id));

  select * into catalog_item from public.content_catalog_items
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type = p_asset_type and local_asset_id = p_local_asset_id
    for update;
  if not found then
    asset_uuid := gen_random_uuid();
    insert into public.content_catalog_items (
      item_id, workspace_id, project_id, asset_type, local_asset_id, display_name,
      status, current_version, current_hash
    ) values (
      asset_uuid, p_workspace_id, p_project_id, p_asset_type, p_local_asset_id,
      p_display_name, 'active', 1, payload_hash
    );
    insert into public.content_catalog_versions (
      item_id, version, workspace_id, project_id, content_hash, payload,
      source_project_revision, created_by
    ) values (
      asset_uuid, 1, p_workspace_id, p_project_id, payload_hash, p_payload,
      p_record_revision, (select auth.uid())
    );
    return asset_uuid;
  end if;
  asset_uuid := catalog_item.item_id;

  if catalog_item.current_hash is distinct from payload_hash then
    next_version := catalog_item.current_version + 1;
    insert into public.content_catalog_versions (
      item_id, version, workspace_id, project_id, content_hash, payload,
      source_project_revision, created_by
    ) values (
      asset_uuid, next_version, p_workspace_id, p_project_id, payload_hash, p_payload,
      p_record_revision, (select auth.uid())
    );
    update public.content_catalog_items set
      display_name = p_display_name,
      status = 'active',
      current_version = next_version,
      current_hash = payload_hash,
      updated_at = now()
    where item_id = asset_uuid;
  elsif catalog_item.display_name is distinct from p_display_name
    or catalog_item.status <> 'active' then
    update public.content_catalog_items set
      display_name = p_display_name,
      status = 'active',
      updated_at = now()
    where item_id = asset_uuid;
  end if;
  return asset_uuid;
end;
$function$;
revoke all on function public.content_catalog_sync_asset(uuid, text, bigint, text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.sync_cloud_project_content_catalog(
  p_workspace_id uuid,
  p_project_id text,
  p_record jsonb,
  p_record_revision bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  topic jsonb;
  block_list jsonb;
  snippet jsonb;
  variable jsonb;
  condition_item jsonb;
  topic_id text;
  parent_id text;
  active_theme text;
  display text;
  local_id text;
  asset_uuid uuid;
  payload jsonb;
  row_order bigint;
  seen_topics text[] := '{}';
  seen_snippets text[] := '{}';
  seen_variables text[] := '{}';
  seen_conditions text[] := '{}';
  topics_valid boolean := false;
  snippets_valid boolean := false;
  variables_valid boolean := false;
  conditions_valid boolean := false;
  topic_content_valid boolean;
  content_map jsonb;
  theme_map jsonb;
  project_meta jsonb;
begin
  if p_status <> 'active' or jsonb_typeof(p_record) is distinct from 'object' then return; end if;
  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text), hashtext(p_project_id));

  topic_content_valid := not (p_record ? 'topicContent')
    or jsonb_typeof(p_record->'topicContent') = 'object';
  content_map := case when topic_content_valid and jsonb_typeof(p_record->'topicContent') = 'object'
    then p_record->'topicContent' else '{}'::jsonb end;
  topics_valid := true;
  if topic_content_valid and jsonb_typeof(p_record->'appToc') = 'array'
    and jsonb_array_length(p_record->'appToc') <= 1000 then
    for topic, row_order in
      select value, ordinality from jsonb_array_elements(p_record->'appToc')
        with ordinality as entry(value, ordinality)
    loop
      payload := null;
      begin
        if jsonb_typeof(topic) <> 'object'
          or jsonb_typeof(topic->'id') <> 'number'
          or coalesce(topic->>'id', '') !~ '^-?[0-9]+$'
          or abs((topic->>'id')::numeric) > 9007199254740991
          or jsonb_typeof(topic->'title') <> 'string'
          or btrim(topic->>'title') = '' then continue; end if;
        if jsonb_typeof(topic->'topicId') = 'string' and btrim(topic->>'topicId') <> '' then
          topic_id := btrim(topic->>'topicId');
        else
          topic_id := 'legacy-' || (topic->>'id');
        end if;
        if char_length(topic_id) > 512 or topic_id = any(seen_topics) then continue; end if;
        local_id := topic_id;
        display := left(btrim(topic->>'title'), 500);

        if content_map ? topic_id then
          if jsonb_typeof(content_map->topic_id) <> 'array' then continue; end if;
          block_list := content_map->topic_id;
        elsif content_map ? (topic->>'id') then
          if jsonb_typeof(content_map->(topic->>'id')) <> 'array' then continue; end if;
          block_list := content_map->(topic->>'id');
        else
          block_list := '[]'::jsonb;
        end if;
        if octet_length(convert_to(block_list::text, 'UTF8')) > 65536 then continue; end if;
        block_list := public.content_catalog_clean_json(block_list);
        parent_id := null;
        if topic ? 'parentTopicId' and jsonb_typeof(topic->'parentTopicId') = 'string' then
          parent_id := nullif(btrim(topic->>'parentTopicId'), '');
        elsif topic ? 'parentId' and topic->'parentId' <> 'null'::jsonb then
          select case
            when jsonb_typeof(candidate.value->'topicId') = 'string'
              and btrim(candidate.value->>'topicId') <> '' then btrim(candidate.value->>'topicId')
            else 'legacy-' || (candidate.value->>'id')
          end into parent_id
          from jsonb_array_elements(p_record->'appToc') as candidate(value)
          where candidate.value->>'id' = topic->>'parentId'
            and jsonb_typeof(candidate.value) = 'object'
          limit 1;
          if parent_id is null then parent_id := topic->>'parentId'; end if;
        end if;
        payload := jsonb_build_object(
          'title', btrim(topic->>'title'),
          'level', case when topic ? 'level' then topic->'level' else 'null'::jsonb end,
          'order', row_order,
          'parentId', parent_id,
          'blocks', block_list
        );
      exception when data_exception then
        payload := null;
      end;
      if payload is not null and not (local_id = any(seen_topics)) then
        asset_uuid := public.content_catalog_sync_asset(
          p_workspace_id, p_project_id, p_record_revision, 'topic', local_id, display, payload
        );
        if asset_uuid is not null then seen_topics := array_append(seen_topics, local_id); end if;
      end if;
    end loop;
  end if;

  snippets_valid := true;
  if jsonb_typeof(p_record->'snippets') = 'array'
    and jsonb_array_length(p_record->'snippets') <= 1000 then
    for snippet in
      select value from jsonb_array_elements(p_record->'snippets') with ordinality as entry(value, ordinality)
    loop
      payload := null;
      begin
        if jsonb_typeof(snippet) <> 'object'
          or jsonb_typeof(snippet->'id') <> 'string'
          or jsonb_typeof(snippet->'name') <> 'string'
          or jsonb_typeof(snippet->'content') <> 'string'
          or btrim(snippet->>'id') = '' or btrim(snippet->>'name') = ''
          or char_length(btrim(snippet->>'id')) > 512
          or char_length(btrim(snippet->>'name')) > 500
          or char_length(snippet->>'content') > 60000 then continue; end if;
        local_id := btrim(snippet->>'id');
        if local_id = any(seen_snippets) then continue; end if;
        payload := jsonb_build_object(
          'id', local_id, 'name', btrim(snippet->>'name'), 'content', snippet->>'content'
        );
      exception when data_exception then
        payload := null;
      end;
      if payload is not null and not (local_id = any(seen_snippets)) then
        asset_uuid := public.content_catalog_sync_asset(
          p_workspace_id, p_project_id, p_record_revision, 'snippet', local_id,
          left(btrim(snippet->>'name'), 500), payload
        );
        if asset_uuid is not null then seen_snippets := array_append(seen_snippets, local_id); end if;
      end if;
    end loop;
  end if;

  project_meta := case when jsonb_typeof(p_record->'projectMeta') = 'object'
    then p_record->'projectMeta' else '{}'::jsonb end;
  theme_map := case when jsonb_typeof(p_record->'themeVariables') = 'object'
    then p_record->'themeVariables' else '{}'::jsonb end;
  active_theme := case when jsonb_typeof(project_meta->'themeId') = 'string'
    then nullif(btrim(project_meta->>'themeId'), '') else null end;
  variables_valid := true;
  if active_theme is not null and jsonb_typeof(theme_map->active_theme) = 'array'
    and jsonb_array_length(theme_map->active_theme) <= 1000 then
    for variable in
      select value from jsonb_array_elements(theme_map->active_theme) with ordinality as entry(value, ordinality)
    loop
      payload := null;
      begin
        if jsonb_typeof(variable) <> 'object'
          or jsonb_typeof(variable->'id') <> 'string'
          or jsonb_typeof(variable->'name') <> 'string'
          or btrim(variable->>'id') = '' or btrim(variable->>'name') = ''
          or char_length(btrim(variable->>'id')) > 512
          or char_length(btrim(variable->>'name')) > 500
          or octet_length(convert_to(variable::text, 'UTF8')) > 65536
          or (variable ? 'description' and jsonb_typeof(variable->'description') <> 'string')
          or jsonb_typeof(variable->'value') is distinct from 'string' then continue; end if;
        local_id := btrim(variable->>'id');
        if local_id = any(seen_variables) then continue; end if;
        payload := jsonb_build_object(
          'id', local_id, 'name', btrim(variable->>'name'), 'value', variable->'value',
          'description', coalesce(variable->'description', '""'::jsonb)
        );
      exception when data_exception then
        payload := null;
      end;
      if payload is not null and not (local_id = any(seen_variables)) then
        asset_uuid := public.content_catalog_sync_asset(
          p_workspace_id, p_project_id, p_record_revision, 'variable', local_id,
          left(btrim(variable->>'name'), 500), payload
        );
        if asset_uuid is not null then seen_variables := array_append(seen_variables, local_id); end if;
      end if;
    end loop;
  end if;

  conditions_valid := true;
  if jsonb_typeof(p_record->'conditionGroups') = 'array'
    and jsonb_array_length(p_record->'conditionGroups') <= 1000 then
    for condition_item in
      select value from jsonb_array_elements(p_record->'conditionGroups') with ordinality as entry(value, ordinality)
    loop
      payload := null;
      begin
        if jsonb_typeof(condition_item) <> 'object'
          or jsonb_typeof(condition_item->'id') <> 'string'
          or jsonb_typeof(condition_item->'group') <> 'string'
          or btrim(condition_item->>'id') = '' or btrim(condition_item->>'group') = ''
          or char_length(btrim(condition_item->>'id')) > 512
          or char_length(btrim(condition_item->>'group')) > 500
          or jsonb_typeof(condition_item->'tags') is distinct from 'array'
          or (jsonb_typeof(condition_item->'tags') = 'array'
            and exists (
              select 1 from jsonb_array_elements(condition_item->'tags') as tag(value)
              where jsonb_typeof(tag.value) <> 'string'
            ))
          or octet_length(convert_to(condition_item::text, 'UTF8')) > 65536 then continue; end if;
        local_id := btrim(condition_item->>'id');
        if local_id = any(seen_conditions) then continue; end if;
        payload := jsonb_build_object(
          'id', local_id, 'group', btrim(condition_item->>'group'),
          'tags', case when jsonb_typeof(condition_item->'tags') = 'array'
            then condition_item->'tags' else '[]'::jsonb end
        );
      exception when data_exception then
        payload := null;
      end;
      if payload is not null and not (local_id = any(seen_conditions)) then
        asset_uuid := public.content_catalog_sync_asset(
          p_workspace_id, p_project_id, p_record_revision, 'condition', local_id,
          left(btrim(condition_item->>'group'), 500), payload
        );
        if asset_uuid is not null then seen_conditions := array_append(seen_conditions, local_id); end if;
      end if;
    end loop;
  end if;

  if topics_valid then
    update public.content_catalog_items set status = 'retired', updated_at = now()
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type = 'topic' and status = 'active'
      and not (local_asset_id = any(seen_topics));
  end if;
  if snippets_valid then
    update public.content_catalog_items set status = 'retired', updated_at = now()
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type = 'snippet' and status = 'active'
      and not (local_asset_id = any(seen_snippets));
  end if;
  if variables_valid then
    update public.content_catalog_items set status = 'retired', updated_at = now()
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type = 'variable' and status = 'active'
      and not (local_asset_id = any(seen_variables));
  end if;
  if conditions_valid then
    update public.content_catalog_items set status = 'retired', updated_at = now()
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type = 'condition' and status = 'active'
      and not (local_asset_id = any(seen_conditions));
  end if;
end;
$function$;
revoke all on function public.sync_cloud_project_content_catalog(uuid, text, jsonb, bigint, text)
  from public, anon, authenticated;

create or replace function public.capture_cloud_project_content_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'active' then
    perform public.sync_cloud_project_content_catalog(
      new.workspace_id, new.project_id, new.record, new.record_revision, new.status
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.capture_cloud_project_content_catalog() from public, anon, authenticated;

drop trigger if exists cloud_projects_content_catalog_insert on public.cloud_projects;
create trigger cloud_projects_content_catalog_insert
  after insert on public.cloud_projects
  for each row execute function public.capture_cloud_project_content_catalog();
drop trigger if exists cloud_projects_content_catalog_update on public.cloud_projects;
create trigger cloud_projects_content_catalog_update
  after update of record, status on public.cloud_projects
  for each row
  when (
    old.status is distinct from new.status
    or old.record->'appToc' is distinct from new.record->'appToc'
    or old.record->'topicContent' is distinct from new.record->'topicContent'
    or old.record->'snippets' is distinct from new.record->'snippets'
    or old.record->'themeVariables' is distinct from new.record->'themeVariables'
    or old.record->'conditionGroups' is distinct from new.record->'conditionGroups'
    or old.record->'projectMeta'->'themeId' is distinct from new.record->'projectMeta'->'themeId'
  )
  execute function public.capture_cloud_project_content_catalog();

-- Backfill in a deterministic project order. Stable item IDs make re-running
-- this migration harmless; only missing or changed content creates versions.
do $backfill$
declare
  project_row public.cloud_projects%rowtype;
begin
  for project_row in
    select * from public.cloud_projects where status = 'active'
    order by workspace_id, project_id
  loop
    perform public.sync_cloud_project_content_catalog(
      project_row.workspace_id, project_row.project_id, project_row.record,
      project_row.record_revision, project_row.status
    );
  end loop;
end;
$backfill$;

-- Mark the exact item whose FK cascade is deleting versions. Nested triggers
-- alone are not evidence of a parent cascade (an unrelated trigger can nest DML).
create or replace function public.mark_content_catalog_item_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  marked_items text;
  item_uuid text;
begin
  item_uuid := old.item_id::text;
  marked_items := nullif(current_setting('app.content_catalog_deleting_items', true), '');
  if marked_items is null then
    perform set_config('app.content_catalog_deleting_items', item_uuid, true);
  elsif array_position(string_to_array(marked_items, ','), item_uuid) is null then
    perform set_config('app.content_catalog_deleting_items', marked_items || ',' || item_uuid, true);
  end if;
  return old;
end;
$function$;
revoke all on function public.mark_content_catalog_item_delete() from public, anon, authenticated;
drop trigger if exists content_catalog_items_mark_delete on public.content_catalog_items;
create trigger content_catalog_items_mark_delete
  before delete on public.content_catalog_items
  for each row execute function public.mark_content_catalog_item_delete();

-- Deletion by a catalog item/cloud project cascade is allowed, but direct or
-- otherwise nested version updates/deletes remain forbidden.
create or replace function public.guard_content_catalog_version_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and pg_trigger_depth() > 1
    and old.item_id::text = any(string_to_array(
      current_setting('app.content_catalog_deleting_items', true), ','
    )) then
    return old;
  end if;
  raise exception 'Content catalog versions are immutable'
    using errcode = '42501';
end;
$function$;
revoke all on function public.guard_content_catalog_version_immutability() from public, anon, authenticated;
drop trigger if exists content_catalog_versions_immutable on public.content_catalog_versions;
create trigger content_catalog_versions_immutable
  before update or delete on public.content_catalog_versions
  for each row execute function public.guard_content_catalog_version_immutability();

insert into public.cloud_schema_versions(component, version)
values ('content-catalog', 1)
on conflict (component) do update set version = excluded.version;

comment on table public.content_catalog_items is
  'Project-local stable identities for searchable authored content; current state is derived from cloud_projects.record.';
comment on table public.content_catalog_versions is
  'Immutable snapshots of normalized content catalog payloads; visible only while the parent cloud project is active.';