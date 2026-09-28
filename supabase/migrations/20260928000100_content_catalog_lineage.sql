-- Resolve optional record lineage metadata only after the v1 catalog trigger
-- has synchronized the destination items. This deliberately does not touch
-- catalog payloads, hashes, or versions.
create or replace function public.sync_cloud_project_content_catalog_lineage(
  p_workspace_id uuid,
  p_project_id text,
  p_record jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  destination public.content_catalog_items%rowtype;
  origins jsonb;
  category_origins jsonb;
  origin jsonb;
  origin_item_text text;
  origin_project text;
  origin_version_text text;
  origin_item_uuid uuid;
  origin_version_number integer;
  resolved_origin_uuid uuid;
begin
  origins := case when jsonb_typeof(p_record->'contentOrigins') = 'object'
    then p_record->'contentOrigins' else '{}'::jsonb end;

  for destination in
    select * from public.content_catalog_items
    where workspace_id = p_workspace_id and project_id = p_project_id
      and asset_type in ('topic', 'snippet', 'variable', 'condition')
  loop
    category_origins := case
      when jsonb_typeof(origins->destination.asset_type) = 'object'
        then origins->destination.asset_type
      else '{}'::jsonb
    end;
    origin := category_origins->destination.local_asset_id;
    resolved_origin_uuid := null;
    origin_item_text := null;
    origin_project := null;
    origin_version_text := null;
    origin_version_number := null;

    if jsonb_typeof(origin) = 'object'
      and jsonb_typeof(origin->'originItemId') = 'string'
      and jsonb_typeof(origin->'originProjectId') = 'string'
      and jsonb_typeof(origin->'originVersion') = 'number' then
      origin_item_text := origin->>'originItemId';
      origin_project := origin->>'originProjectId';
      origin_version_text := origin->>'originVersion';

      if origin_item_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and origin_project <> ''
        and origin_version_text ~ '^[1-9][0-9]{0,9}$' then
        origin_item_uuid := origin_item_text::uuid;
        if origin_version_text::numeric <= 2147483647 then
          origin_version_number := origin_version_text::integer;
          select source.item_id into resolved_origin_uuid
          from public.content_catalog_items as source
          join public.cloud_projects as source_project
            on source_project.workspace_id = source.workspace_id
             and source_project.project_id = source.project_id
             and source_project.status = 'active'
          join public.content_catalog_versions as source_version
            on source_version.item_id = source.item_id
             and source_version.version = origin_version_number
             and source_version.workspace_id = source.workspace_id
             and source_version.project_id = source.project_id
          where source.item_id = origin_item_uuid
            and source.workspace_id = p_workspace_id
            and source.project_id = origin_project
            and source.asset_type = destination.asset_type
            and source.item_id <> destination.item_id;
        end if;
      end if;
    end if;

    update public.content_catalog_items set
      origin_item_id = resolved_origin_uuid,
      origin_project_id = case when resolved_origin_uuid is not null then origin_project else null end,
      origin_version = case when resolved_origin_uuid is not null then origin_version_number else null end
    where item_id = destination.item_id
      and (
        origin_item_id is distinct from resolved_origin_uuid
        or origin_project_id is distinct from case
          when resolved_origin_uuid is not null then origin_project else null end
        or origin_version is distinct from case
          when resolved_origin_uuid is not null then origin_version_number else null end
      );
  end loop;
end;
$function$;
revoke all on function public.sync_cloud_project_content_catalog_lineage(uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.capture_cloud_project_content_catalog_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'active' then
    perform public.sync_cloud_project_content_catalog_lineage(
      new.workspace_id, new.project_id, new.record
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.capture_cloud_project_content_catalog_lineage()
  from public, anon, authenticated;

-- Without an origin FK (which could accidentally SET NULL the non-null
-- workspace_id), clear dependent current pointers before an origin item or its
-- cloud project is cascaded away. Historical catalog versions remain untouched.
create or replace function public.clear_content_catalog_lineage_on_item_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.content_catalog_items set
    origin_item_id = null,
    origin_project_id = null,
    origin_version = null
  where origin_item_id = old.item_id
    and workspace_id = old.workspace_id
    and origin_project_id = old.project_id;
  return old;
end;
$function$;
revoke all on function public.clear_content_catalog_lineage_on_item_delete()
  from public, anon, authenticated;

drop trigger if exists content_catalog_items_clear_lineage_on_delete
  on public.content_catalog_items;
create trigger content_catalog_items_clear_lineage_on_delete
  before delete on public.content_catalog_items
  for each row execute function public.clear_content_catalog_lineage_on_item_delete();

-- PostgreSQL orders same-event triggers by name. "content_lineage" sorts after
-- the v1 "content_catalog" triggers, including on INSERT and status changes.
drop trigger if exists cloud_projects_content_lineage_insert on public.cloud_projects;
create trigger cloud_projects_content_lineage_insert
  after insert on public.cloud_projects
  for each row
  when (new.status = 'active')
  execute function public.capture_cloud_project_content_catalog_lineage();

drop trigger if exists cloud_projects_content_lineage_update on public.cloud_projects;
create trigger cloud_projects_content_lineage_update
  after update of record, status on public.cloud_projects
  for each row
  when (
    new.status = 'active'
    and (
      old.status is distinct from new.status
      or old.record->'contentOrigins' is distinct from new.record->'contentOrigins'
      or old.record->'appToc' is distinct from new.record->'appToc'
      or old.record->'topicContent' is distinct from new.record->'topicContent'
      or old.record->'snippets' is distinct from new.record->'snippets'
      or old.record->'themeVariables' is distinct from new.record->'themeVariables'
      or old.record->'conditionGroups' is distinct from new.record->'conditionGroups'
      or old.record->'projectMeta'->'themeId' is distinct from new.record->'projectMeta'->'themeId'
    )
  )
  execute function public.capture_cloud_project_content_catalog_lineage();

-- Existing lineage hints are optional and untrusted until resolved against the
-- same-workspace catalog item and its exact immutable version.
do $backfill$
declare
  project_row public.cloud_projects%rowtype;
begin
  for project_row in
    select * from public.cloud_projects
    where status = 'active'
    order by workspace_id, project_id
  loop
    perform public.sync_cloud_project_content_catalog_lineage(
      project_row.workspace_id, project_row.project_id, project_row.record
    );
  end loop;
end;
$backfill$;

insert into public.cloud_schema_versions(component, version)
values ('content-catalog', 2)
on conflict (component) do update
set version = greatest(public.cloud_schema_versions.version, excluded.version);