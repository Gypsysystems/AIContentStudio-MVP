-- Executable PostgreSQL integration test. Run only against a disposable local
-- database named ai_catalog_test_<hex>; the Playwright gate creates and drops
-- that database, and refuses network/production connection strings.
\set ON_ERROR_STOP on

do $database_guard$
begin
  if current_database() !~ '^ai_catalog_test_[0-9a-f]+$' then
    raise exception 'AI catalog SQL integration requires a disposable ai_catalog_test_<hex> database';
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
create table public.cloud_schema_versions (
  component text primary key,
  version integer not null
);
create function public.workspace_can(p_workspace_id uuid, p_permission text)
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
revoke all on function public.workspace_can(uuid, text) from public, anon;
grant execute on function public.workspace_can(uuid, text) to authenticated;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.workspace_memberships, public.workspace_role_permissions to authenticated;

insert into public.workspace_role_permissions values
  ('owner','read'), ('admin','read'), ('editor','read'), ('viewer','read'),
  ('owner','create'), ('admin','create'), ('editor','create'),
  ('owner','write'), ('admin','write'), ('editor','write'),
  ('owner','delete'), ('admin','delete');

insert into public.workspaces values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into auth.users values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000005');
insert into public.workspace_memberships values
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','admin'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','editor'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','viewer'),
  ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005','owner');

\i supabase/migrations/20260926000300_ai_catalog.sql

create function public.ai_catalog_pause_test_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.asset_id = 'revocation-race' then
    perform pg_advisory_xact_lock(88776655, 123456789);
    perform pg_sleep(4);
  end if;
  return new;
end;
$function$;
create trigger ai_catalog_pause_test_insert
  before insert on public.ai_catalog_versions
  for each row execute function public.ai_catalog_pause_test_insert();

set role authenticated;

do $test_rpc$
declare
  result jsonb;
  caught boolean;
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000001', 'invalid-initial-pack', null,
      '{"kind":"prompt-pack","name":"Invalid Initial Pack","description":"","definition":{"prompts":[{"id":"prompt-start","version":2,"state":"test","name":"Not initial","template":"","variables":[]}]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'Initial prompt pack accepted a non-v1/draft prompt'; end if;

  result := public.ai_catalog_command(
    'create', '10000000-0000-0000-0000-000000000001', 'pack-history', null,
    '{"kind":"prompt-pack","name":"History Pack","description":"","definition":{"prompts":[{"id":"prompt-once","version":1,"state":"draft","name":"Initial prompt","template":"","variables":[]}]}}',
    null
  );
  if result->'asset'->>'version' <> '1' then raise exception 'Owner create failed'; end if;

  result := public.ai_catalog_command(
    'revise', '10000000-0000-0000-0000-000000000001', 'pack-history', 1,
    '{"kind":"prompt-pack","name":"History Pack","description":"","definition":{"prompts":[]}}',
    null
  );
  if result->'asset'->>'version' <> '2' then raise exception 'Prompt removal revision failed'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'revise', '10000000-0000-0000-0000-000000000001', 'pack-history', 2,
      '{"kind":"prompt-pack","name":"History Pack","description":"","definition":{"prompts":[{"id":"prompt-once","version":1,"state":"draft","name":"Reused prompt","template":"","variables":[]}]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'A prompt ID removed from prior history was incorrectly reusable'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'revise', '10000000-0000-0000-0000-000000000001', 'pack-history', 2,
      '{"kind":"prompt-pack","name":"History Pack","description":"","definition":{"prompts":[{"id":"brand-new","version":2,"state":"draft","name":"New prompt","template":"","variables":[]}]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'A new prompt was allowed to skip version 1'; end if;

  result := public.ai_catalog_command(
    'revise', '10000000-0000-0000-0000-000000000001', 'pack-history', 2,
    '{"kind":"prompt-pack","name":"History Pack","description":"","definition":{"prompts":[{"id":"brand-new","version":1,"state":"draft","name":"New prompt","template":"","variables":[]}]}}',
    null
  );
  if result->'asset'->>'version' <> '3' then raise exception 'New prompt v1/draft was not accepted'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'revise', '10000000-0000-0000-0000-000000000001', 'pack-history', 1,
      '{"kind":"prompt-pack","name":"Stale","description":"","definition":{"prompts":[]}}',
      null
    );
  exception when sqlstate '40001' then caught := true;
  end;
  if not caught then raise exception 'Stale expectedVersion was not rejected as a conflict'; end if;

  result := public.ai_catalog_command(
    'delete', '10000000-0000-0000-0000-000000000001', 'pack-history', 3, null, null
  );
  if result->'asset'->>'version' <> '4' or result->'asset'->>'state' <> 'archived' then
    raise exception 'Delete did not append an archived tombstone';
  end if;
  result := public.ai_catalog_command('list', '10000000-0000-0000-0000-000000000001');
  if exists (select 1 from jsonb_array_elements(result->'assets') asset(value)
    where asset.value->>'id' = 'pack-history') then
    raise exception 'Archived tombstone was not excluded from list';
  end if;
  result := public.ai_catalog_command('history', '10000000-0000-0000-0000-000000000001', 'pack-history');
  if jsonb_array_length(result->'versions') <> 4 then raise exception 'History omitted archived version'; end if;

  result := public.ai_catalog_command(
    'create', '10000000-0000-0000-0000-000000000001', 'ref-blueprint', null,
    '{"kind":"blueprint","name":"Blueprint","description":"","definition":{"contentType":"SOP","sections":[]}}',
    null
  );
  if result->'asset'->>'version' <> '1' then raise exception 'Blueprint creation failed'; end if;

  result := public.ai_catalog_command(
    'create', '10000000-0000-0000-0000-000000000001', 'valid-workflow', null,
    '{"kind":"workflow","name":"Workflow","description":"","definition":{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":{"id":"ref-blueprint","version":1},"steps":[]}}',
    null
  );
  if result->'asset'->>'version' <> '1' then raise exception 'Exact same-workspace workflow reference was rejected'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000001', 'invalid-workflow', null,
      '{"kind":"workflow","name":"Missing reference","description":"","definition":{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":{"id":"ref-blueprint","version":99},"steps":[]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'Workflow accepted a missing version reference'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'revise', '10000000-0000-0000-0000-000000000001', 'valid-workflow', 1,
      '{"kind":"workflow","name":"Missing reference","description":"","definition":{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":{"id":"ref-blueprint","version":99},"steps":[]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'Workflow revise accepted a missing version reference'; end if;

  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000001', 'wrong-kind-workflow', null,
      '{"kind":"workflow","name":"Wrong kind","description":"","definition":{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":{"id":"valid-workflow","version":1},"steps":[]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'Workflow accepted a reference of the wrong kind'; end if;

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
  result := public.ai_catalog_command(
    'create', '10000000-0000-0000-0000-000000000001', 'admin-asset', null,
    '{"kind":"reference-set","name":"Admin asset","description":"","definition":{"entries":[]}}',
    null
  );
  if result->'asset'->>'createdBy' <> '20000000-0000-0000-0000-000000000002' then
    raise exception 'Workspace admin could not mutate catalog';
  end if;

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000001', 'editor-asset', null,
      '{"kind":"reference-set","name":"Editor asset","description":"","definition":{"entries":[]}}',
      null
    );
  exception when sqlstate '42501' then caught := true;
  end;
  if not caught then raise exception 'Workspace editor unexpectedly mutated catalog'; end if;

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
  result := public.ai_catalog_command('list', '10000000-0000-0000-0000-000000000001');
  if jsonb_typeof(result->'assets') <> 'array' then raise exception 'Workspace viewer could not read catalog'; end if;
  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000001', 'viewer-asset', null,
      '{"kind":"reference-set","name":"Viewer asset","description":"","definition":{"entries":[]}}',
      null
    );
  exception when sqlstate '42501' then caught := true;
  end;
  if not caught then raise exception 'Workspace viewer unexpectedly mutated catalog'; end if;
  caught := false;
  begin
    perform public.ai_catalog_command('list', '10000000-0000-0000-0000-000000000002');
  exception when sqlstate '42501' then caught := true;
  end;
  if not caught then raise exception 'Viewer accessed another workspace catalog'; end if;

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
  caught := false;
  begin
    perform public.ai_catalog_command(
      'create', '10000000-0000-0000-0000-000000000002', 'cross-workspace-workflow', null,
      '{"kind":"workflow","name":"Cross workspace","description":"","definition":{"capability":"draft","model":{"mode":"auto"},"promptPack":null,"referenceSet":null,"blueprint":{"id":"ref-blueprint","version":1},"steps":[]}}',
      null
    );
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception 'Workflow resolved a reference from another workspace'; end if;
end;
$test_rpc$;

reset role;