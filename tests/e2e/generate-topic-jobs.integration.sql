-- Disposable-only PostgreSQL fixture for the durable generation-job RPCs.
\set ON_ERROR_STOP on

do $database_guard$
begin
  if current_database() !~ '^generate_topic_jobs_test_[0-9a-f]+$' then
    raise exception 'Topic jobs integration requires a disposable generate_topic_jobs_test_<hex> database';
  end if;
end;
$database_guard$;

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
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
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  primary key (workspace_id, user_id)
);
create table public.workspace_role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);
create table public.cloud_projects (
  project_id text primary key,
  workspace_id uuid not null references public.workspaces(id),
  owner_user_id uuid not null references auth.users(id),
  record_revision bigint not null,
  record jsonb not null,
  status text not null,
  unique (workspace_id, project_id)
);
create table public.ai_catalog_versions (
  workspace_id uuid not null references public.workspaces(id),
  asset_id text not null,
  version integer not null,
  kind text not null,
  state text not null,
  name text not null,
  description text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  primary key (workspace_id, asset_id, version)
);
create function public.ai_catalog_workflow_references_exist(p_workspace_id uuid, p_definition jsonb)
returns boolean
language sql stable
as $function$
  select true;
$function$;
create function public.ai_catalog_version_json(p_row public.ai_catalog_versions)
returns jsonb
language sql immutable
as $function$
  select jsonb_build_object(
    'workspaceId', (p_row).workspace_id, 'id', (p_row).asset_id,
    'kind', (p_row).kind, 'version', (p_row).version, 'state', (p_row).state,
    'name', (p_row).name, 'description', (p_row).description,
    'definition', (p_row).definition, 'createdAt', (p_row).created_at,
    'createdBy', (p_row).created_by
  );
$function$;
create table public.ai_connections (
  workspace_id uuid not null,
  provider_id text not null,
  revision integer not null,
  test_state text not null,
  test_proof text,
  tested_at timestamptz,
  ciphertext text,
  primary key (workspace_id, provider_id)
);
create table public.cloud_schema_versions (
  component text primary key,
  version integer not null
);

create or replace function public.workspace_can(p_workspace_id uuid, p_permission text)
returns boolean
language sql stable security invoker
as $function$
  select exists (
    select 1
    from public.workspace_memberships membership
    join public.workspace_role_permissions permission
      on permission.role = membership.role and permission.permission = p_permission
    where membership.workspace_id = p_workspace_id
      and membership.user_id = (select auth.uid())
  );
$function$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.workspace_can(uuid, text) to authenticated;
grant select on public.workspace_memberships, public.workspace_role_permissions to authenticated;

insert into public.workspace_role_permissions(role, permission) values
  ('owner', 'read'), ('owner', 'write'),
  ('editor', 'read'), ('editor', 'write'),
  ('viewer', 'read');

insert into public.workspaces(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into auth.users(id) values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004');
insert into public.workspace_memberships(workspace_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','editor'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','viewer'),
  ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004','owner');

insert into public.cloud_projects(
  project_id, workspace_id, owner_user_id, record_revision, record, status
) values
  ('project-a', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 7,
   '{"projectId":"project-a","appToc":[{"id":1,"topicId":"topic-a"},{"id":2,"topicId":"topic-b"},{"id":3,"topicId":"topic-c"},{"id":4,"topicId":"topic-d"},{"id":5,"topicId":"topic-e"}],"privateProjectMarker":"worker-only-record"}',
   'active'),
  ('project-b', '10000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000004', 2,
   '{"projectId":"project-b","appToc":[{"id":1,"topicId":"other-topic"}]}',
   'active');
insert into public.ai_catalog_versions(
  workspace_id, asset_id, version, kind, state, name, description, definition, created_by
) values
  ('10000000-0000-0000-0000-000000000001', 'wf-exact', 3, 'workflow', 'published',
   'Exact workflow', '', '{"capability":"draft","model":{"mode":"pinned","providerId":"provider-a","modelId":"model-a"},"promptPack":null,"referenceSet":null,"blueprint":null,"steps":[]}',
   '20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', 'wf-other', 1, 'workflow', 'published',
   'Different workflow', '', '{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":null,"steps":[]}',
   '20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'wf-exact', 3, 'workflow', 'published',
   'Other workspace workflow', '', '{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":null,"steps":[]}',
   '20000000-0000-0000-0000-000000000004');
insert into public.ai_connections(
  workspace_id, provider_id, revision, test_state, test_proof, tested_at, ciphertext
) values (
  '10000000-0000-0000-0000-000000000001', 'provider-a', 4, 'verified',
  repeat('a', 64), '2026-09-28T12:34:56.000Z', 'never-return-this'
);

\i supabase/migrations/20260928000200_generate_topic_jobs.sql