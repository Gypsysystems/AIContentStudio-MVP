-- Immutable workspace-scoped AI catalog versions. This stores definitions
-- only; credentials, provider secrets, and execution requests are prohibited.

create or replace function public.ai_catalog_has_keys(p_value jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_typeof(p_value) = 'object', false)
    and (select coalesce(array_agg(key order by key), '{}')
         from jsonb_object_keys(p_value) as keys(key))
      = (select coalesce(array_agg(key order by key), '{}') from unnest(p_keys) as keys(key));
$function$;
revoke all on function public.ai_catalog_has_keys(jsonb, text[]) from public, anon, authenticated;

create or replace function public.ai_catalog_valid_input(
  p_kind text, p_name text, p_description text, p_definition jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  subitem jsonb;
  item_id text;
  seen_ids text[];
begin
  if p_kind not in ('workflow', 'prompt-pack', 'reference-set', 'blueprint')
    or p_name is null or char_length(p_name) < 1 or char_length(p_name) > 120 or btrim(p_name) = ''
    or p_description is null or char_length(p_description) > 1000
    or jsonb_typeof(p_definition) <> 'object'
    or octet_length(convert_to(jsonb_build_object(
      'kind', p_kind, 'name', p_name, 'description', p_description, 'definition', p_definition
    )::text, 'UTF8')) > 32000 then
    return false;
  end if;

  -- Reject secret-like keys at any nesting depth, including unknown fields.
  if exists (
    with recursive nodes(value, key_name) as (
      select p_definition, null::text
      union all
      select child.value, child.key_name
      from nodes as parent
      cross join lateral (
        select object_child.value, object_child.key as key_name
        from jsonb_each(
          case when jsonb_typeof(parent.value) = 'object' then parent.value else '{}'::jsonb end
        ) as object_child(key, value)
        union all
        select array_child.value, null::text as key_name
        from jsonb_array_elements(
          case when jsonb_typeof(parent.value) = 'array' then parent.value else '[]'::jsonb end
        ) as array_child(value)
      ) as child
    )
    select 1 from nodes
    where key_name ~* '(credential|secret|token|api.?key|password|authorization|private.?key)'
  ) then return false; end if;

  if p_kind = 'workflow' then
    if not public.ai_catalog_has_keys(p_definition,
      array['capability','model','promptPack','referenceSet','blueprint','steps'])
      or jsonb_typeof(p_definition->'capability') is distinct from 'string'
      or char_length(p_definition->>'capability') not between 1 and 100
      or jsonb_typeof(p_definition->'model') <> 'object'
      or jsonb_typeof(p_definition->'steps') <> 'array'
      or jsonb_array_length(p_definition->'steps') > 30 then return false; end if;
    if p_definition->'model'->>'mode' = 'auto' then
      if not public.ai_catalog_has_keys(p_definition->'model', array['mode']) then return false; end if;
    elsif p_definition->'model'->>'mode' = 'pinned' then
      if not public.ai_catalog_has_keys(p_definition->'model', array['mode','providerId','modelId'])
        or coalesce(p_definition->'model'->>'providerId', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or coalesce(p_definition->'model'->>'modelId', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
      then return false; end if;
    else return false; end if;
    foreach item_id in array array['promptPack','referenceSet','blueprint'] loop
      item := p_definition->item_id;
      if item <> 'null'::jsonb and (
        not public.ai_catalog_has_keys(item, array['id','version'])
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or coalesce(item->>'version','') !~ '^[1-9][0-9]*$'
        or (item->>'version')::numeric > 9007199254740991
      ) then return false; end if;
    end loop;
    seen_ids := '{}';
    for item in select value from jsonb_array_elements(p_definition->'steps') loop
      if not public.ai_catalog_has_keys(item, array['id','capability'])
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or coalesce(item->>'capability','') = ''
        or char_length(item->>'capability') > 100
        or item->>'id' = any(seen_ids) then return false; end if;
      seen_ids := array_append(seen_ids, item->>'id');
    end loop;
  elsif p_kind = 'prompt-pack' then
    if not public.ai_catalog_has_keys(p_definition, array['prompts'])
      or jsonb_typeof(p_definition->'prompts') <> 'array'
      or jsonb_array_length(p_definition->'prompts') > 50 then return false; end if;
    seen_ids := '{}';
    for item in select value from jsonb_array_elements(p_definition->'prompts') loop
      if not public.ai_catalog_has_keys(item, array['id','version','state','name','template','variables'])
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or item->>'id' = any(seen_ids)
        or coalesce(item->>'version','') !~ '^[1-9][0-9]*$'
        or (item->>'version')::numeric > 9007199254740991
        or coalesce(item->>'state','') not in ('draft','test','published')
        or coalesce(item->>'name','') = '' or char_length(item->>'name') > 120
        or jsonb_typeof(item->'template') is distinct from 'string' or char_length(item->>'template') > 8000
        or jsonb_typeof(item->'variables') is distinct from 'array' or jsonb_array_length(item->'variables') > 30
        or exists (select 1 from jsonb_array_elements(item->'variables') as variable(value)
          where jsonb_typeof(variable.value) is distinct from 'string'
            or variable.value #>> '{}' !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$')
      then return false; end if;
      seen_ids := array_append(seen_ids, item->>'id');
    end loop;
  elsif p_kind = 'reference-set' then
    if not public.ai_catalog_has_keys(p_definition, array['entries'])
      or jsonb_typeof(p_definition->'entries') <> 'array'
      or jsonb_array_length(p_definition->'entries') > 100 then return false; end if;
    seen_ids := '{}';
    for item in select value from jsonb_array_elements(p_definition->'entries') loop
      if not public.ai_catalog_has_keys(item, array['id','type','title','locator','note'])
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or item->>'id' = any(seen_ids)
        or coalesce(item->>'type','') not in ('approved-example','terminology')
        or coalesce(item->>'title','') = '' or char_length(item->>'title') > 160
        or jsonb_typeof(item->'locator') is distinct from 'string' or char_length(item->>'locator') > 500
        or jsonb_typeof(item->'note') is distinct from 'string' or char_length(item->>'note') > 1000
      then return false; end if;
      seen_ids := array_append(seen_ids, item->>'id');
    end loop;
  else
    if not public.ai_catalog_has_keys(p_definition, array['contentType','sections'])
      or coalesce(p_definition->>'contentType','') not in ('User Guide','Admin Guide','SOP','Quick Start','Training','Features & Capabilities')
      or jsonb_typeof(p_definition->'sections') is distinct from 'array'
      or jsonb_array_length(p_definition->'sections') > 100 then return false; end if;
    seen_ids := '{}';
    for item in select value from jsonb_array_elements(p_definition->'sections') loop
      if not public.ai_catalog_has_keys(item, array['id','title','required','rules'])
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
        or item->>'id' = any(seen_ids)
        or coalesce(item->>'title','') = '' or char_length(item->>'title') > 160
        or jsonb_typeof(item->'required') is distinct from 'boolean'
        or jsonb_typeof(item->'rules') is distinct from 'array' or jsonb_array_length(item->'rules') > 20
        or exists (select 1 from jsonb_array_elements(item->'rules') as rule_item(value)
          where jsonb_typeof(rule_item.value) is distinct from 'string'
            or char_length(rule_item.value #>> '{}') > 500)
      then return false; end if;
      seen_ids := array_append(seen_ids, item->>'id');
    end loop;
  end if;
  return true;
exception when others then
  return false;
end;
$function$;
revoke all on function public.ai_catalog_valid_input(text, text, text, jsonb) from public, anon, authenticated;

create table if not exists public.ai_catalog_versions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_id text not null check (asset_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'),
  version integer not null check (version > 0),
  kind text not null check (kind in ('workflow','prompt-pack','reference-set','blueprint')),
  state text not null check (state in ('draft','test','published','archived')),
  name text not null,
  description text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  primary key (workspace_id, asset_id, version),
  check (public.ai_catalog_valid_input(kind, name, description, definition))
);
create index if not exists ai_catalog_versions_latest
  on public.ai_catalog_versions (workspace_id, asset_id, version desc);

alter table public.ai_catalog_versions enable row level security;
revoke all on public.ai_catalog_versions from public, anon, authenticated;
grant select on public.ai_catalog_versions to authenticated;
drop policy if exists ai_catalog_versions_read_workspace on public.ai_catalog_versions;
create policy ai_catalog_versions_read_workspace on public.ai_catalog_versions
  for select to authenticated using (public.workspace_can(workspace_id, 'read'));

create or replace function public.guard_ai_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception 'AI catalog versions are immutable'
      using errcode = '42501';
  end if;
  if new.created_by <> (select auth.uid())
    or not public.ai_catalog_valid_input(new.kind, new.name, new.description, new.definition) then
    raise exception 'Invalid AI catalog version'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_ai_catalog_version() from public, anon, authenticated;
drop trigger if exists ai_catalog_versions_immutable on public.ai_catalog_versions;
create trigger ai_catalog_versions_immutable
  before insert or update or delete on public.ai_catalog_versions
  for each row execute function public.guard_ai_catalog_version();

create or replace function public.ai_catalog_version_json(p_row public.ai_catalog_versions)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'workspaceId', (p_row).workspace_id,
    'id', (p_row).asset_id,
    'kind', (p_row).kind,
    'version', (p_row).version,
    'state', (p_row).state,
    'name', (p_row).name,
    'description', (p_row).description,
    'definition', (p_row).definition,
    'createdAt', (p_row).created_at,
    'createdBy', (p_row).created_by
  );
$function$;
revoke all on function public.ai_catalog_version_json(public.ai_catalog_versions) from public, anon, authenticated;

create or replace function public.ai_catalog_workflow_references_exist(
  p_workspace_id uuid, p_definition jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select not exists (
    select 1
    from (values
      ('promptPack'::text, 'prompt-pack'::text),
      ('referenceSet'::text, 'reference-set'::text),
      ('blueprint'::text, 'blueprint'::text)
    ) as expected(field_name, kind)
    cross join lateral (select p_definition -> expected.field_name as ref) as referenced
    where referenced.ref <> 'null'::jsonb
      and not exists (
        select 1
        from public.ai_catalog_versions as target
        where target.workspace_id = p_workspace_id
          and target.asset_id = referenced.ref->>'id'
          and target.version::numeric = (referenced.ref->>'version')::numeric
          and target.kind = expected.kind
      )
  );
$function$;
revoke all on function public.ai_catalog_workflow_references_exist(uuid, jsonb) from public, anon, authenticated;

create or replace function public.ai_catalog_command(
  p_action text,
  p_workspace_id uuid,
  p_asset_id text default null,
  p_expected_version integer default null,
  p_payload jsonb default null,
  p_state text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_row public.ai_catalog_versions%rowtype;
  next_row public.ai_catalog_versions%rowtype;
  next_state text;
  history_json jsonb;
  item jsonb;
  subitem jsonb;
  actor_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_action = 'list' or p_action = 'history' then
    if not public.workspace_can(p_workspace_id, 'read') then
      raise exception 'Workspace read membership required' using errcode = '42501';
    end if;
    if p_action = 'history' and (p_asset_id is null or p_asset_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$') then
      raise exception 'Invalid asset ID' using errcode = '22023';
    end if;
    if p_action = 'list' then
      select coalesce(jsonb_agg(public.ai_catalog_version_json(latest) order by latest.name, latest.asset_id), '[]'::jsonb)
        into history_json
      from (
        select distinct on (asset_id) *
        from public.ai_catalog_versions
        where workspace_id = p_workspace_id
        order by asset_id, version desc
      ) as latest
      where latest.state <> 'archived';
    else
      select coalesce(jsonb_agg(public.ai_catalog_version_json(version_row) order by version_row.version), '[]'::jsonb)
        into history_json
      from public.ai_catalog_versions as version_row
      where version_row.workspace_id = p_workspace_id and version_row.asset_id = p_asset_id;
    end if;
    return case when p_action = 'history'
      then jsonb_build_object('versions', history_json)
      else jsonb_build_object('assets', history_json)
    end;
  end if;

  -- Hold the caller's current membership against role updates/deletion until
  -- this mutation commits. Re-check authorization after taking the row lock.
  select membership.role into actor_role
  from public.workspace_memberships as membership
  where membership.workspace_id = p_workspace_id
    and membership.user_id = (select auth.uid())
  for share;
  if not found then
    raise exception 'Active workspace membership required' using errcode = '42501';
  end if;
  if actor_role not in ('owner','admin') then
    raise exception 'Owner or admin role required to mutate AI catalog'
      using errcode = '42501';
  end if;

  if p_action = 'create' then
    if p_asset_id is null or p_asset_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
      or not public.ai_catalog_has_keys(p_payload, array['kind','name','description','definition'])
      or not public.ai_catalog_valid_input(p_payload->>'kind', p_payload->>'name',
        p_payload->>'description', p_payload->'definition') then
      raise exception 'Invalid AI asset input' using errcode = '22023';
    end if;
    if p_payload->>'kind' = 'prompt-pack'
      and exists (
        select 1
        from jsonb_array_elements(p_payload->'definition'->'prompts') as prompt(value)
        where prompt.value->>'version' <> '1' or prompt.value->>'state' <> 'draft'
      ) then
      raise exception 'Initial prompts must start at version 1 in draft state'
        using errcode = '22023';
    end if;
    if p_payload->>'kind' = 'workflow'
      and not public.ai_catalog_workflow_references_exist(p_workspace_id, p_payload->'definition') then
      raise exception 'Workflow references must resolve to exact versions in this workspace'
        using errcode = '22023';
    end if;
    insert into public.ai_catalog_versions (
      workspace_id, asset_id, version, kind, state, name, description, definition, created_by
    ) values (
      p_workspace_id, p_asset_id, 1, p_payload->>'kind', 'draft',
      p_payload->>'name', p_payload->>'description', p_payload->'definition', (select auth.uid())
    ) returning * into next_row;
  else
    if p_action not in ('revise','transition','delete')
      or p_asset_id is null or p_asset_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
      or p_expected_version is null or p_expected_version < 1 then
      raise exception 'Invalid AI catalog command' using errcode = '22023';
    end if;
    -- Lock the logical asset, not only its current version row: versions are
    -- append-only, so row locks alone let concurrent writers insert the same
    -- next version after both have locked the same prior snapshot.
    perform pg_advisory_xact_lock(hashtext(p_workspace_id::text), hashtext(p_asset_id));
    select * into current_row from public.ai_catalog_versions
      where workspace_id = p_workspace_id and asset_id = p_asset_id
      order by version desc limit 1 for update;
    if not found then raise exception 'AI asset not found' using errcode = 'P0002'; end if;
    if current_row.version <> p_expected_version then
      raise exception 'AI asset version changed' using errcode = '40001';
    end if;
    if current_row.state = 'archived' then
      raise exception 'Archived AI assets cannot be changed' using errcode = '22023';
    end if;

    if p_action = 'revise' then
      if not public.ai_catalog_has_keys(p_payload, array['kind','name','description','definition'])
        or not public.ai_catalog_valid_input(p_payload->>'kind', p_payload->>'name',
        p_payload->>'description', p_payload->'definition')
        or p_payload->>'kind' <> current_row.kind then
        raise exception 'Invalid AI asset revision' using errcode = '22023';
      end if;
      if current_row.kind = 'prompt-pack' then
        for item in select value from jsonb_array_elements(current_row.definition->'prompts') loop
          subitem := (select candidate.value from jsonb_array_elements(p_payload->'definition'->'prompts') as candidate(value)
            where candidate.value->>'id' = item->>'id' limit 1);
          if subitem is not null and (
            ((subitem->>'version')::numeric = (item->>'version')::numeric
              and subitem <> item)
            or ((subitem->>'version')::numeric <> (item->>'version')::numeric
              and ((subitem->>'version')::numeric <> (item->>'version')::numeric + 1
                or not (
                  subitem->>'state' = 'draft'
                  or (item->>'state' = 'draft' and subitem->>'state' in ('test','published','archived'))
                  or (item->>'state' = 'test' and subitem->>'state' in ('draft','published','archived'))
                  or (item->>'state' = 'published' and subitem->>'state' = 'archived')
                )))
          ) then raise exception 'Invalid prompt revision' using errcode = '22023'; end if;
        end loop;
        -- IDs are permanent within a pack's history. A removed prompt cannot
        -- be resurrected, and truly new prompts always start at v1/draft.
        for subitem in select value from jsonb_array_elements(p_payload->'definition'->'prompts') loop
          item := (
            select current_prompt.value
            from jsonb_array_elements(current_row.definition->'prompts') as current_prompt(value)
            where current_prompt.value->>'id' = subitem->>'id'
            limit 1
          );
          if item is null then
            if exists (
              select 1
              from public.ai_catalog_versions as prior_version
              cross join lateral jsonb_array_elements(prior_version.definition->'prompts') as historical_prompt(value)
              where prior_version.workspace_id = p_workspace_id
                and prior_version.asset_id = p_asset_id
                and prior_version.kind = 'prompt-pack'
                and historical_prompt.value->>'id' = subitem->>'id'
            ) then
              raise exception 'Removed prompt IDs cannot be reused' using errcode = '22023';
            end if;
            if (subitem->>'version')::numeric <> 1 or subitem->>'state' <> 'draft' then
              raise exception 'New prompts must start at version 1 in draft state'
                using errcode = '22023';
            end if;
          end if;
        end loop;
      end if;
      if p_payload->>'kind' = 'workflow'
        and not public.ai_catalog_workflow_references_exist(p_workspace_id, p_payload->'definition') then
        raise exception 'Workflow references must resolve to exact versions in this workspace'
          using errcode = '22023';
      end if;
      next_state := 'draft';
      insert into public.ai_catalog_versions (
        workspace_id, asset_id, version, kind, state, name, description, definition, created_by
      ) values (
        p_workspace_id, p_asset_id, current_row.version + 1, current_row.kind, next_state,
        p_payload->>'name', p_payload->>'description', p_payload->'definition', (select auth.uid())
      ) returning * into next_row;
    else
      next_state := case when p_action = 'delete' then 'archived' else p_state end;
      if coalesce(next_state,'') not in ('draft','test','published','archived') then
        raise exception 'Invalid AI asset state' using errcode = '22023';
      end if;
      if not (
        (current_row.state = 'draft' and next_state in ('test','published','archived'))
        or (current_row.state = 'test' and next_state in ('draft','published','archived'))
        or (current_row.state = 'published' and next_state = 'archived')
      ) then raise exception 'Invalid AI asset state transition' using errcode = '22023'; end if;
      if next_state = 'published' and current_row.kind = 'prompt-pack'
        and exists (select 1 from jsonb_array_elements(current_row.definition->'prompts') as prompt(value)
          where prompt.value->>'state' <> 'published') then
        raise exception 'All prompts must be published before their pack' using errcode = '22023';
      end if;
      insert into public.ai_catalog_versions (
        workspace_id, asset_id, version, kind, state, name, description, definition, created_by
      ) values (
        p_workspace_id, p_asset_id, current_row.version + 1, current_row.kind, next_state,
        current_row.name, current_row.description, current_row.definition, (select auth.uid())
      ) returning * into next_row;
    end if;
  end if;
  return jsonb_build_object('asset', public.ai_catalog_version_json(next_row));
end;
$function$;
revoke all on function public.ai_catalog_command(text, uuid, text, integer, jsonb, text) from public, anon;
grant execute on function public.ai_catalog_command(text, uuid, text, integer, jsonb, text) to authenticated;

insert into public.cloud_schema_versions(component, version)
values ('ai-catalog', 1)
on conflict (component) do update set version = excluded.version;