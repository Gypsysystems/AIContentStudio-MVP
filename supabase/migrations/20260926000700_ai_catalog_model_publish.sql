-- Align pinned model identifiers with provider model IDs while retaining the
-- established, shorter provider ID validation.
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
        or coalesce(p_definition->'model'->>'modelId', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
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

create or replace function public.guard_ai_catalog_published_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reference record;
  target public.ai_catalog_versions%rowtype;
  latest_state text;
begin
  if new.kind <> 'workflow' or new.state <> 'published' then
    return new;
  end if;
  if new.definition->'model'->>'mode' <> 'pinned'
    or new.definition->'promptPack' = 'null'::jsonb
    or new.definition->'referenceSet' = 'null'::jsonb
    or new.definition->'blueprint' = 'null'::jsonb then
    raise exception 'Published workflows require a pinned model and all three references'
      using errcode = '22023';
  end if;
  for reference in
    select refs.field_name, refs.kind, new.definition->refs.field_name as value
    from (values
      ('promptPack'::text, 'prompt-pack'::text),
      ('referenceSet'::text, 'reference-set'::text),
      ('blueprint'::text, 'blueprint'::text)
    ) as refs(field_name, kind)
  loop
    -- Serialize the publication check with any concurrent mutation of the
    -- referenced logical asset, using the same lock namespace as the RPC.
    perform pg_advisory_xact_lock(
      hashtext(new.workspace_id::text),
      hashtext(reference.value->>'id')
    );
    select * into target
    from public.ai_catalog_versions
    where workspace_id = new.workspace_id
      and asset_id = reference.value->>'id'
      and version::numeric = (reference.value->>'version')::numeric
      and kind = reference.kind;
    if not found or target.state <> 'published' then
      raise exception 'Published workflows require exact published references in the same workspace'
        using errcode = '22023';
    end if;
    select state into latest_state
    from public.ai_catalog_versions
    where workspace_id = target.workspace_id and asset_id = target.asset_id
    order by version desc limit 1;
    if latest_state = 'archived' then
      raise exception 'Published workflows cannot reference an archived latest version'
        using errcode = '22023';
    end if;
    if reference.kind = 'prompt-pack' and exists (
      select 1
      from jsonb_array_elements(target.definition->'prompts') as prompt(value)
      where prompt.value->>'state' <> 'published'
    ) then
      raise exception 'All prompts must be published before their pack'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.guard_ai_catalog_published_workflow() from public, anon, authenticated;
drop trigger if exists ai_catalog_published_workflow_references on public.ai_catalog_versions;
create trigger ai_catalog_published_workflow_references
  before insert on public.ai_catalog_versions
  for each row execute function public.guard_ai_catalog_published_workflow();

insert into public.cloud_schema_versions(component, version)
values ('ai-catalog', 2)
on conflict (component) do update set version = excluded.version;