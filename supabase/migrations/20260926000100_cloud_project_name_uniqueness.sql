-- Make normalized project names unique per workspace, including in-progress
-- restore rows. Existing projects are preserved and conflicting display names
-- are deterministically suffixed before the unique index is installed.

create or replace function public.normalize_cloud_project_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.lower(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        coalesce(p_name, ''),
        U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
        ' ',
        'g'
      )
    )
  );
$function$;

-- Prevent project create/restore/rename requests from racing the backfill and
-- unique-index installation.
lock table public.cloud_projects in access exclusive mode;

create table if not exists public.cloud_project_name_migrations (
  workspace_id uuid not null,
  project_id text not null,
  previous_name text,
  assigned_name text not null,
  migrated_at timestamptz not null default now(),
  primary key (workspace_id, project_id),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade
);
alter table public.cloud_project_name_migrations enable row level security;
revoke all on public.cloud_project_name_migrations from public, anon, authenticated;

create temporary table cloud_project_name_rewrite as
with named_projects as (
  select
    project.workspace_id,
    project.project_id,
    project.created_at,
    project.record->>'projectName' as previous_name,
    case
      when pg_catalog.jsonb_typeof(project.record->'projectName') = 'string'
        and public.normalize_cloud_project_name(project.record->>'projectName') <> ''
        then project.record->>'projectName'
      else 'Untitled Project'
    end as base_name
  from public.cloud_projects as project
),
ranked_projects as (
  select
    named.*,
    public.normalize_cloud_project_name(named.base_name) as base_key,
    row_number() over (
      partition by named.workspace_id, public.normalize_cloud_project_name(named.base_name)
      order by named.created_at asc, named.project_id asc
    ) as duplicate_number
  from named_projects as named
)
select
  workspace_id,
  project_id,
  created_at,
  previous_name,
  base_name,
  base_key,
  duplicate_number,
  case when duplicate_number = 1 then base_name end as assigned_name,
  case when duplicate_number = 1 then base_key end as assigned_key
from ranked_projects;

do $migration$
declare
  duplicate_row record;
  suffix_number integer;
  candidate_name text;
  candidate_key text;
begin
  -- Reserve every earliest name first. A duplicate must not take a name that
  -- belongs to another project's original, even when that name ends in "(2)".
  for duplicate_row in
    select workspace_id, project_id, created_at, base_name, duplicate_number
    from pg_temp.cloud_project_name_rewrite
    where duplicate_number > 1
    order by workspace_id, created_at, project_id
  loop
    suffix_number := duplicate_row.duplicate_number;
    loop
      candidate_name := duplicate_row.base_name || ' (' || suffix_number::text || ')';
      candidate_key := public.normalize_cloud_project_name(candidate_name);
      exit when not exists (
        select 1
        from pg_temp.cloud_project_name_rewrite as assigned
        where assigned.workspace_id = duplicate_row.workspace_id
          and assigned.assigned_key = candidate_key
      );
      suffix_number := suffix_number + 1;
    end loop;

    update pg_temp.cloud_project_name_rewrite
      set assigned_name = candidate_name,
          assigned_key = candidate_key
      where workspace_id = duplicate_row.workspace_id
        and project_id = duplicate_row.project_id;
  end loop;
end;
$migration$;

insert into public.cloud_project_name_migrations (
  workspace_id, project_id, previous_name, assigned_name
)
select workspace_id, project_id, previous_name, assigned_name
from pg_temp.cloud_project_name_rewrite
where previous_name is distinct from assigned_name;

update public.cloud_projects as project
set record = pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        project.record,
        '{projectName}',
        pg_catalog.to_jsonb(rewrite.assigned_name),
        true
      ),
      '{recordRevision}',
      pg_catalog.to_jsonb(project.record_revision + 1),
      true
    ),
    record_revision = project.record_revision + 1
from pg_temp.cloud_project_name_rewrite as rewrite
where project.workspace_id = rewrite.workspace_id
  and project.project_id = rewrite.project_id
  and project.record->>'projectName' is distinct from rewrite.assigned_name;

alter table public.cloud_projects
  add constraint cloud_projects_project_name_nonempty
  check (
    pg_catalog.jsonb_typeof(record->'projectName') = 'string'
    and public.normalize_cloud_project_name(record->>'projectName') <> ''
  );

create unique index cloud_projects_workspace_name_key
  on public.cloud_projects (
    workspace_id,
    public.normalize_cloud_project_name(record->>'projectName')
  );

insert into public.cloud_schema_versions (component, version)
values ('project-storage', 2)
on conflict (component) do update set version = excluded.version;

drop table pg_temp.cloud_project_name_rewrite;