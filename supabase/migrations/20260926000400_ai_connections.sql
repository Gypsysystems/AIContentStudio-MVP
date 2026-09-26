-- Apply only from the exact committed GitHub SQL. Credential material is never
-- readable through the authenticated/anon PostgREST table API.
-- Provision the ai_connection_reader LOGIN password outside source control;
-- use its restricted connection URL only in the application server.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_connection_reader') then
    create role ai_connection_reader login;
  end if;
end $$;

create table public.ai_connections (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null check (provider_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'),
  revision integer not null check (revision > 0),
  ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  key_version text not null check (key_version = 'v1'),
  test_state text not null default 'untested'
    check (test_state in ('untested','verified','failed','unavailable')),
  test_proof text,
  tested_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, provider_id),
  check (octet_length(ciphertext) between 1 and 8192)
);
alter table public.ai_connections enable row level security;
revoke all on public.ai_connections from public, anon, authenticated;
grant usage on schema public to ai_connection_reader;
grant select (workspace_id, provider_id, revision, ciphertext, nonce, tag, key_version)
  on public.ai_connections to ai_connection_reader;
create policy ai_connection_reader_ciphertext on public.ai_connections
  for select to ai_connection_reader using (true);

create table public.ai_connection_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null,
  revision integer not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('create','replace','test','delete')),
  outcome text not null check (outcome in ('saved','recorded','deleted')),
  occurred_at timestamptz not null default now()
);
alter table public.ai_connection_audit enable row level security;
revoke all on public.ai_connection_audit from public, anon, authenticated, ai_connection_reader;

create or replace function public.ai_connection_command(
  p_action text,
  p_workspace_id uuid,
  p_provider_id text default null,
  p_expected_revision integer default null,
  p_ciphertext text default null,
  p_nonce text default null,
  p_tag text default null,
  p_state text default null,
  p_proof text default null,
  p_tested_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  record_row public.ai_connections%rowtype;
  payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_action = 'list' then
    if not public.workspace_can(p_workspace_id, 'read') then
      raise exception 'Workspace read membership required' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'workspaceId', c.workspace_id, 'providerId', c.provider_id,
      'revision', c.revision, 'state', c.test_state,
      'proof', c.test_proof, 'testedAt', c.tested_at,
      'updatedAt', c.updated_at, 'updatedBy', c.updated_by
    ) order by c.provider_id), '[]'::jsonb) into payload
    from public.ai_connections c where c.workspace_id = p_workspace_id;
    return jsonb_build_object('connections', payload);
  end if;

  select membership.role into actor_role
  from public.workspace_memberships membership
  where membership.workspace_id = p_workspace_id
    and membership.user_id = (select auth.uid())
  for share;
  if not found then
    raise exception 'Active workspace membership required' using errcode = '42501';
  end if;
  if actor_role not in ('owner','admin') then
    raise exception 'Owner or admin role required' using errcode = '42501';
  end if;
  if p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$' then
    raise exception 'Invalid provider' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_workspace_id::text), pg_catalog.hashtext(p_provider_id));
  select * into record_row from public.ai_connections
    where workspace_id = p_workspace_id and provider_id = p_provider_id for update;

  if p_action = 'create' then
    if found or p_expected_revision is not null then
      raise exception 'Connection revision changed' using errcode = '40001';
    end if;
  elsif not found then
    raise exception 'Connection not found' using errcode = 'P0002';
  elsif p_expected_revision is null or record_row.revision <> p_expected_revision then
    raise exception 'Connection revision changed' using errcode = '40001';
  end if;

  if p_action in ('create','replace') then
    if p_ciphertext is null or p_nonce is null or p_tag is null
      or length(p_ciphertext) not between 4 and 11000
      or length(p_nonce) <> 16 or length(p_tag) <> 24
      or p_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
      or p_nonce !~ '^[A-Za-z0-9+/]+={0,2}$'
      or p_tag !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Invalid encrypted credential' using errcode = '22023';
    end if;
    insert into public.ai_connections (
      workspace_id, provider_id, revision, ciphertext, nonce, tag, key_version,
      test_state, test_proof, tested_at, updated_by
    ) values (
      p_workspace_id, p_provider_id, case when p_action = 'create' then 1 else record_row.revision + 1 end,
      pg_catalog.decode(p_ciphertext, 'base64'), pg_catalog.decode(p_nonce, 'base64'),
      pg_catalog.decode(p_tag, 'base64'), 'v1', 'untested', null, null, (select auth.uid())
    )
    on conflict (workspace_id, provider_id) do update set
      revision = excluded.revision, ciphertext = excluded.ciphertext,
      nonce = excluded.nonce, tag = excluded.tag, key_version = excluded.key_version,
      test_state = 'untested', test_proof = null, tested_at = null,
      updated_at = now(), updated_by = excluded.updated_by
    returning * into record_row;
    insert into public.ai_connection_audit (workspace_id, provider_id, revision, actor_id, action, outcome)
      values (p_workspace_id, p_provider_id, record_row.revision, (select auth.uid()), p_action, 'saved');
  elsif p_action = 'test' then
    if p_state not in ('verified','failed','unavailable')
      or p_proof is null or length(p_proof) <> 64 or p_proof !~ '^[0-9a-f]+$'
      or p_tested_at is null then
      raise exception 'Invalid test result' using errcode = '22023';
    end if;
    update public.ai_connections set test_state = p_state, test_proof = p_proof,
      tested_at = p_tested_at, updated_at = now(), updated_by = (select auth.uid())
      where workspace_id = p_workspace_id and provider_id = p_provider_id
      returning * into record_row;
    insert into public.ai_connection_audit (workspace_id, provider_id, revision, actor_id, action, outcome)
      values (p_workspace_id, p_provider_id, record_row.revision, (select auth.uid()), 'test', 'recorded');
  elsif p_action = 'delete' then
    delete from public.ai_connections
      where workspace_id = p_workspace_id and provider_id = p_provider_id;
    insert into public.ai_connection_audit (workspace_id, provider_id, revision, actor_id, action, outcome)
      values (p_workspace_id, p_provider_id, record_row.revision, (select auth.uid()), 'delete', 'deleted');
    return jsonb_build_object('deleted', true, 'providerId', p_provider_id, 'revision', record_row.revision);
  else
    raise exception 'Invalid connection command' using errcode = '22023';
  end if;
  return jsonb_build_object('connection', jsonb_build_object(
    'workspaceId', record_row.workspace_id, 'providerId', record_row.provider_id,
    'revision', record_row.revision, 'state', record_row.test_state,
    'proof', record_row.test_proof, 'testedAt', record_row.tested_at,
    'updatedAt', record_row.updated_at, 'updatedBy', record_row.updated_by
  ));
end;
$function$;
revoke all on function public.ai_connection_command(text, uuid, text, integer, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ai_connection_command(text, uuid, text, integer, text, text, text, text, text, timestamptz)
  to authenticated;