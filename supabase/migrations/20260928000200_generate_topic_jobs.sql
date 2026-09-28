-- Durable, workspace-scoped topic generation jobs. This migration only defines
-- the schema and RPCs; it does not provision a password or apply itself.

do $role$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'generate_topic_worker') then
    create role generate_topic_worker login;
  end if;
end
$role$;
alter role generate_topic_worker with login password null nobypassrls;

create table public.generate_topic_jobs (
  job_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  topic_id text not null,
  workflow_id text not null,
  workflow_version integer not null check (workflow_version > 0),
  input_revision bigint not null check (input_revision >= 0),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  requester_id uuid not null references auth.users(id),
  status text not null check (status in ('queued','running','retry-wait','succeeded','failed')),
  phase text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  draft jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id)
    references public.cloud_projects(workspace_id, project_id) on delete cascade,
  check (
    (status = 'running' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'running' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'succeeded' and draft is not null) or (status <> 'succeeded' and draft is null))
);
create unique index generate_topic_jobs_one_active_project_topic
  on public.generate_topic_jobs (workspace_id, project_id, topic_id)
  where status in ('queued','running','retry-wait');
create unique index generate_topic_jobs_idempotency_active_unique
  on public.generate_topic_jobs (idempotency_key)
  where status in ('queued','running','retry-wait');
create index generate_topic_jobs_claimable
  on public.generate_topic_jobs (next_attempt_at, created_at)
  where status in ('queued','retry-wait');
create index generate_topic_jobs_project_created
  on public.generate_topic_jobs (workspace_id, project_id, topic_id, created_at desc);

create table public.generate_topic_worker_heartbeats (
  worker_name text primary key check (worker_name = 'generate_topic_worker'),
  heartbeat_at timestamptz not null
);
alter table public.generate_topic_worker_heartbeats enable row level security;
revoke all on public.generate_topic_worker_heartbeats
  from public, anon, authenticated, generate_topic_worker;

alter table public.generate_topic_jobs enable row level security;
revoke all on public.generate_topic_jobs from public, anon, authenticated, generate_topic_worker;
grant usage on schema public to generate_topic_worker;

create policy generate_topic_jobs_worker_access on public.generate_topic_jobs
  for all to generate_topic_worker using (true) with check (true);

create or replace function public.generate_topic_job_json(p_job public.generate_topic_jobs)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'jobId', (p_job).job_id,
    'projectId', (p_job).project_id,
    'topicId', (p_job).topic_id,
    'workflowId', (p_job).workflow_id,
    'workflowVersion', (p_job).workflow_version,
    'inputRevision', (p_job).input_revision,
    'status', (p_job).status,
    'phase', (p_job).phase,
    'attemptCount', (p_job).attempt_count,
    'maxAttempts', (p_job).max_attempts,
    'nextAttemptAt', (p_job).next_attempt_at,
    'createdAt', (p_job).created_at,
    'updatedAt', (p_job).updated_at
  ) || case when (p_job).status = 'succeeded'
      then jsonb_build_object('draft', (p_job).draft) else '{}'::jsonb end
    || case when (p_job).status = 'failed'
      then jsonb_build_object(
        'errorCode', (p_job).error_code,
        'errorMessage', (p_job).error_message
      ) else '{}'::jsonb end;
$function$;
revoke all on function public.generate_topic_job_json(public.generate_topic_jobs)
  from public, anon, authenticated, generate_topic_worker;

create or replace function public.gt_job_enqueue(
  p_project_id text,
  p_topic_id text,
  p_workflow_id text,
  p_workflow_version integer,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project_row public.cloud_projects%rowtype;
  workflow_row public.ai_catalog_versions%rowtype;
  requester_role text;
  new_job public.generate_topic_jobs%rowtype;
  stable_key text;
  local_topic text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_project_id is null or char_length(p_project_id) not between 1 and 256
    or p_topic_id is null or char_length(p_topic_id) not between 1 and 512
    or p_workflow_id is null or p_workflow_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$'
    or p_workflow_version is null or p_workflow_version < 1
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid topic job input' using errcode = '22023';
  end if;

  select * into project_row
  from public.cloud_projects
  where project_id = p_project_id and status = 'active'
  for update;
  if not found then raise exception 'Active project not found' using errcode = 'P0002'; end if;

  select membership.role into requester_role
  from public.workspace_memberships as membership
  where membership.workspace_id = project_row.workspace_id
    and membership.user_id = (select auth.uid())
  for share;
  if not found or not exists (
    select 1 from public.workspace_role_permissions as permission
    where permission.role = requester_role and permission.permission = 'write'
  ) then
    raise exception 'Current workspace write membership required' using errcode = '42501';
  end if;
  if project_row.record_revision <> p_expected_revision then
    raise exception 'Project revision changed' using errcode = '40001';
  end if;

  local_topic := p_topic_id;
  if not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(project_row.record->'appToc') = 'array'
        then project_row.record->'appToc' else '[]'::jsonb end
    ) as topic(value)
    where (topic.value->>'topicId' = local_topic)
       or (topic.value->>'topicId' is null
         and jsonb_typeof(topic.value->'id') = 'number'
         and local_topic = 'legacy-' || (topic.value->>'id'))
  ) then
    raise exception 'Topic is not present in the active project' using errcode = 'P0002';
  end if;

  select * into workflow_row
  from public.ai_catalog_versions
  where workspace_id = project_row.workspace_id
    and asset_id = p_workflow_id and version = p_workflow_version
    and kind = 'workflow' and state = 'published';
  if not found then
    raise exception 'Published workflow version not found in this workspace' using errcode = 'P0002';
  end if;
  if not public.ai_catalog_workflow_references_exist(project_row.workspace_id, workflow_row.definition) then
    raise exception 'Workflow references are no longer available' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.generate_topic_worker_heartbeats heartbeat
    where heartbeat.worker_name = 'generate_topic_worker'
      and heartbeat.heartbeat_at > clock_timestamp() - interval '60 seconds'
  ) then
    raise exception 'WORKER_UNAVAILABLE' using errcode = '55000',
      detail = 'Topic generation is temporarily unavailable.';
  end if;

  -- The key is wholly server-derived; no client-supplied fingerprint participates.
  stable_key := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    project_row.workspace_id::text || chr(31) || p_project_id || chr(31) || local_topic
      || chr(31) || p_workflow_id || chr(31) || p_workflow_version::text
      || chr(31) || p_expected_revision::text,
    'UTF8'
  )), 'hex');

  select * into new_job from public.generate_topic_jobs
    where idempotency_key = stable_key
      and status in ('queued','running','retry-wait');
  if found then
    return jsonb_build_object('job', public.generate_topic_job_json(new_job));
  end if;

  insert into public.generate_topic_jobs (
    job_id, workspace_id, project_id, topic_id, workflow_id, workflow_version,
    input_revision, idempotency_key, requester_id, status, phase
  ) values (
    gen_random_uuid(), project_row.workspace_id, p_project_id, local_topic,
    p_workflow_id, p_workflow_version, p_expected_revision, stable_key,
    (select auth.uid()), 'queued', 'queued'
  )
  on conflict do nothing
  returning * into new_job;
  if not found then
    select * into new_job from public.generate_topic_jobs
      where idempotency_key = stable_key
        and status in ('queued','running','retry-wait');
    if found then
      return jsonb_build_object('job', public.generate_topic_job_json(new_job));
    end if;
    raise exception 'An active generation job already exists for this project topic'
      using errcode = '23505';
  end if;
  return jsonb_build_object('job', public.generate_topic_job_json(new_job));
end;
$function$;
revoke all on function public.gt_job_enqueue(text, text, text, integer, bigint)
  from public, anon, generate_topic_worker;
grant execute on function public.gt_job_enqueue(text, text, text, integer, bigint)
  to authenticated;

create or replace function public.gt_job_get(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job_row public.generate_topic_jobs%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into job_row from public.generate_topic_jobs
    where job_id = p_job_id;
  if not found or not public.workspace_can(job_row.workspace_id, 'read')
    or not exists (select 1 from public.cloud_projects p
      where p.workspace_id = job_row.workspace_id and p.project_id = job_row.project_id
        and p.status = 'active') then
    raise exception 'Topic job not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('job', public.generate_topic_job_json(job_row));
end;
$function$;
revoke all on function public.gt_job_get(uuid) from public, anon, generate_topic_worker;
grant execute on function public.gt_job_get(uuid) to authenticated;

create or replace function public.gt_job_list(p_project_id text, p_topic_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project_row public.cloud_projects%rowtype;
  jobs_json jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into project_row from public.cloud_projects
    where project_id = p_project_id and status = 'active';
  if p_topic_id is null or char_length(p_topic_id) not between 1 and 512
    or not found or not public.workspace_can(project_row.workspace_id, 'read') then
    raise exception 'Active readable project not found' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(public.generate_topic_job_json(job_row)
    order by job_row.created_at desc), '[]'::jsonb)
  into jobs_json
  from public.generate_topic_jobs as job_row
  where job_row.workspace_id = project_row.workspace_id
    and job_row.project_id = p_project_id
    and job_row.topic_id = p_topic_id;
  return jsonb_build_object('jobs', jobs_json);
end;
$function$;
revoke all on function public.gt_job_list(text, text) from public, anon, generate_topic_worker;
grant execute on function public.gt_job_list(text, text) to authenticated;

create or replace function public.gt_job_worker_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  beat timestamptz;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  insert into public.generate_topic_worker_heartbeats(worker_name, heartbeat_at)
  values ('generate_topic_worker', clock_timestamp())
  on conflict (worker_name) do update set heartbeat_at = excluded.heartbeat_at
  returning heartbeat_at into beat;
  return jsonb_build_object('heartbeatAt', beat);
end;
$function$;
revoke all on function public.gt_job_worker_heartbeat() from public, anon, authenticated;
grant execute on function public.gt_job_worker_heartbeat() to generate_topic_worker;

create or replace function public.gt_job_claim(p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claimed public.generate_topic_jobs%rowtype;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'Lease duration must be between 30 and 3600 seconds' using errcode = '22023';
  end if;

  update public.generate_topic_jobs
  set status = 'failed', phase = 'failed', lease_token = null, lease_expires_at = null,
      next_attempt_at = null, error_code = 'MAX_ATTEMPTS',
      error_message = 'Generation could not be completed after the allowed attempts.',
      updated_at = now()
  where status = 'running' and lease_expires_at <= now()
    and attempt_count >= max_attempts;

  with candidate as (
    select job_id from public.generate_topic_jobs
    where (
      status in ('queued','retry-wait')
      and (next_attempt_at is null or next_attempt_at <= now())
    ) or (
      status = 'running' and lease_expires_at <= now()
      and attempt_count < max_attempts
    )
    order by coalesce(next_attempt_at, created_at), created_at
    for update skip locked
    limit 1
  )
  update public.generate_topic_jobs as job
  set status = 'running', phase = 'generating',
      attempt_count = job.attempt_count + 1,
      next_attempt_at = null, lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      error_code = null, error_message = null, updated_at = now()
  from candidate
  where job.job_id = candidate.job_id
  returning job.* into claimed;

  if not found then return jsonb_build_object('job', null); end if;
  return jsonb_build_object(
    'job', public.generate_topic_job_json(claimed),
    'leaseToken', claimed.lease_token
  );
end;
$function$;
revoke all on function public.gt_job_claim(integer) from public, anon, authenticated;
grant execute on function public.gt_job_claim(integer) to generate_topic_worker;

create or replace function public.gt_job_context(p_job_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job_row public.generate_topic_jobs%rowtype;
  project_row public.cloud_projects%rowtype;
  workflow_row public.ai_catalog_versions%rowtype;
  prompt_row public.ai_catalog_versions%rowtype;
  reference_row public.ai_catalog_versions%rowtype;
  blueprint_row public.ai_catalog_versions%rowtype;
  selected_provider_id text;
  connection_row public.ai_connections%rowtype;
  connection_metadata jsonb;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  select * into job_row from public.generate_topic_jobs
    where job_id = p_job_id and status = 'running'
      and lease_token = p_lease_token and lease_expires_at > now()
    for update;
  if not found then raise exception 'Job lease is stale or expired' using errcode = '40001'; end if;

  select * into project_row from public.cloud_projects
    where workspace_id = job_row.workspace_id and project_id = job_row.project_id
      and status = 'active' and record_revision = job_row.input_revision;
  if not found then raise exception 'Project revision changed or project is inactive' using errcode = '40001'; end if;
  select * into workflow_row from public.ai_catalog_versions
    where workspace_id = job_row.workspace_id and asset_id = job_row.workflow_id
      and version = job_row.workflow_version and kind = 'workflow';
  if not found then raise exception 'Pinned workflow version is unavailable' using errcode = 'P0002'; end if;

  if jsonb_typeof(workflow_row.definition->'promptPack') = 'object' then
    select * into prompt_row from public.ai_catalog_versions
      where workspace_id = job_row.workspace_id
        and asset_id = workflow_row.definition->'promptPack'->>'id'
        and version::numeric = (workflow_row.definition->'promptPack'->>'version')::numeric
        and kind = 'prompt-pack';
  end if;
  if jsonb_typeof(workflow_row.definition->'referenceSet') = 'object' then
    select * into reference_row from public.ai_catalog_versions
      where workspace_id = job_row.workspace_id
        and asset_id = workflow_row.definition->'referenceSet'->>'id'
        and version::numeric = (workflow_row.definition->'referenceSet'->>'version')::numeric
        and kind = 'reference-set';
  end if;
  if jsonb_typeof(workflow_row.definition->'blueprint') = 'object' then
    select * into blueprint_row from public.ai_catalog_versions
      where workspace_id = job_row.workspace_id
        and asset_id = workflow_row.definition->'blueprint'->>'id'
        and version::numeric = (workflow_row.definition->'blueprint'->>'version')::numeric
        and kind = 'blueprint';
  end if;
  if (jsonb_typeof(workflow_row.definition->'promptPack') = 'object' and prompt_row.workspace_id is null)
    or (jsonb_typeof(workflow_row.definition->'referenceSet') = 'object' and reference_row.workspace_id is null)
    or (jsonb_typeof(workflow_row.definition->'blueprint') = 'object' and blueprint_row.workspace_id is null) then
    raise exception 'Pinned workflow dependency is unavailable' using errcode = 'P0002';
  end if;

  if workflow_row.definition->'model'->>'mode' = 'pinned' then
    selected_provider_id := workflow_row.definition->'model'->>'providerId';
    select * into connection_row from public.ai_connections
      where ai_connections.workspace_id = job_row.workspace_id
        and ai_connections.provider_id = selected_provider_id;
  end if;
  connection_metadata := jsonb_build_object(
    'providerId', selected_provider_id,
    'revision', case when connection_row.workspace_id is null then null else connection_row.revision end,
    'state', case when connection_row.workspace_id is null then null else connection_row.test_state end,
    'proof', case when connection_row.workspace_id is null then null else connection_row.test_proof end,
    'testedAt', case when connection_row.workspace_id is null then null else connection_row.tested_at end
  );

  return jsonb_build_object(
    'job', public.generate_topic_job_json(job_row),
    'record', project_row.record,
    'assets', jsonb_build_object(
      'workflow', public.ai_catalog_version_json(workflow_row),
      'promptPack', case when prompt_row.workspace_id is null then null::jsonb
        else public.ai_catalog_version_json(prompt_row) end,
      'referenceSet', case when reference_row.workspace_id is null then null::jsonb
        else public.ai_catalog_version_json(reference_row) end,
      'blueprint', case when blueprint_row.workspace_id is null then null::jsonb
        else public.ai_catalog_version_json(blueprint_row) end
    ),
    'connectionMetadata', connection_metadata
  );
end;
$function$;
revoke all on function public.gt_job_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gt_job_context(uuid, uuid) to generate_topic_worker;

create or replace function public.gt_job_heartbeat(
  p_job_id uuid, p_lease_token uuid, p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job_row public.generate_topic_jobs%rowtype;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'Lease duration must be between 30 and 3600 seconds' using errcode = '22023';
  end if;
  update public.generate_topic_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where job_id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now()
  returning * into job_row;
  if not found then raise exception 'Job lease is stale or expired' using errcode = '40001'; end if;
  return jsonb_build_object('job', public.generate_topic_job_json(job_row));
end;
$function$;
revoke all on function public.gt_job_heartbeat(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.gt_job_heartbeat(uuid, uuid, integer) to generate_topic_worker;

create or replace function public.gt_job_finish(p_job_id uuid, p_lease_token uuid, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  peek public.generate_topic_jobs%rowtype;
  project_row public.cloud_projects%rowtype;
  job_row public.generate_topic_jobs%rowtype;
  member_can_write boolean;
  project_is_present boolean;
  requester_role text;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  select * into peek from public.generate_topic_jobs where job_id = p_job_id;
  if not found then raise exception 'Topic job not found' using errcode = 'P0002'; end if;
  -- Use the same project lock order as enqueue, then lock/fence the job.
  select * into project_row from public.cloud_projects
    where workspace_id = peek.workspace_id and project_id = peek.project_id
    for update;
  project_is_present := found;
  select * into job_row from public.generate_topic_jobs
    where job_id = p_job_id for update;
  if job_row.status <> 'running' or job_row.lease_token is distinct from p_lease_token
    or job_row.lease_expires_at <= now() then
    raise exception 'Job lease is stale or expired' using errcode = '40001';
  end if;

  select membership.role into requester_role
  from public.workspace_memberships membership
  where membership.workspace_id = job_row.workspace_id
    and membership.user_id = job_row.requester_id
  for share;
  member_can_write := found and exists (
    select 1 from public.workspace_role_permissions permission
    where permission.role = requester_role and permission.permission = 'write'
  );

  if not project_is_present or project_row.status <> 'active'
    or project_row.record_revision <> job_row.input_revision
    or not member_can_write then
    update public.generate_topic_jobs set
      status = 'failed', phase = 'failed', lease_token = null, lease_expires_at = null,
      next_attempt_at = null, draft = null,
      error_code = case when not member_can_write then 'PERMISSION_REVOKED' else 'STALE_PROJECT' end,
      error_message = case when not member_can_write
        then 'The requester no longer has permission to write this project.'
        else 'The project changed before generation could be saved.' end,
      updated_at = now()
    where job_id = p_job_id returning * into job_row;
    return jsonb_build_object('job', public.generate_topic_job_json(job_row));
  end if;

  if jsonb_typeof(p_draft) is distinct from 'object'
    or octet_length(pg_catalog.convert_to(p_draft::text, 'UTF8')) > 262144
    or exists (
      with recursive nodes(value, key_name) as (
        select p_draft, null::text
        union all
        select child.value, child.key_name
        from nodes parent
        cross join lateral (
          select object_child.value, object_child.key as key_name
          from jsonb_each(case when jsonb_typeof(parent.value) = 'object'
            then parent.value else '{}'::jsonb end) object_child(key, value)
          union all
          select array_child.value, null::text
          from jsonb_array_elements(case when jsonb_typeof(parent.value) = 'array'
            then parent.value else '[]'::jsonb end) array_child(value)
        ) child
      )
      select 1 from nodes
      where key_name ~* '(credential|secret|token|api.?key|password|authorization|private.?key)'
    ) then
    raise exception 'Generated draft is invalid or contains restricted fields' using errcode = '22023';
  end if;

  update public.generate_topic_jobs set
    status = 'succeeded', phase = 'complete', draft = p_draft,
    lease_token = null, lease_expires_at = null, next_attempt_at = null,
    error_code = null, error_message = null, updated_at = now()
  where job_id = p_job_id returning * into job_row;
  return jsonb_build_object('job', public.generate_topic_job_json(job_row));
end;
$function$;
revoke all on function public.gt_job_finish(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.gt_job_finish(uuid, uuid, jsonb) to generate_topic_worker;

create or replace function public.gt_job_fail(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job_row public.generate_topic_jobs%rowtype;
  safe_code text;
  safe_message text;
  do_retry boolean;
begin
  if session_user <> 'generate_topic_worker' then
    raise exception 'Worker database role required' using errcode = '42501';
  end if;
  safe_code := case p_error_code
    when 'RATE_LIMITED' then 'RATE_LIMITED'
    when 'PROVIDER_UNAVAILABLE' then 'PROVIDER_UNAVAILABLE'
    when 'INVALID_DRAFT' then 'INVALID_DRAFT'
    when 'STALE_PROJECT' then 'STALE_PROJECT'
    when 'PERMISSION_REVOKED' then 'PERMISSION_REVOKED'
    else 'GENERATION_FAILED'
  end;
  safe_message := case safe_code
    when 'RATE_LIMITED' then 'The generation provider is temporarily rate limited.'
    when 'PROVIDER_UNAVAILABLE' then 'The generation provider is temporarily unavailable.'
    when 'INVALID_DRAFT' then 'The generated draft could not be validated.'
    when 'STALE_PROJECT' then 'The project changed before generation could be saved.'
    when 'PERMISSION_REVOKED' then 'The requester no longer has permission to write this project.'
    else 'Topic generation could not be completed.'
  end;
  update public.generate_topic_jobs
  set status = case when coalesce(p_retryable, false) and attempt_count < max_attempts
      then 'retry-wait' else 'failed' end,
      phase = case when coalesce(p_retryable, false) and attempt_count < max_attempts
        then 'retry-wait' else 'failed' end,
      next_attempt_at = case when coalesce(p_retryable, false) and attempt_count < max_attempts
        then now() + make_interval(secs => least(3600, 15 * (2 ^ greatest(attempt_count - 1, 0))::integer))
        else null end,
      lease_token = null, lease_expires_at = null, draft = null,
      error_code = safe_code, error_message = safe_message, updated_at = now()
  where job_id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now()
  returning * into job_row;
  if not found then raise exception 'Job lease is stale or expired' using errcode = '40001'; end if;
  return jsonb_build_object('job', public.generate_topic_job_json(job_row));
end;
$function$;
revoke all on function public.gt_job_fail(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.gt_job_fail(uuid, uuid, text, text, boolean) to generate_topic_worker;

insert into public.cloud_schema_versions(component, version)
values ('generate-topic-jobs', 1)
on conflict (component) do update
set version = greatest(public.cloud_schema_versions.version, excluded.version);

comment on table public.generate_topic_jobs is
  'Durable topic generation jobs; access is exclusively through authenticated and dedicated worker RPCs.';
comment on function public.gt_job_enqueue(text, text, text, integer, bigint) is
  'Enqueues or returns the deterministic idempotent job for an active project topic and exact published workflow revision.';
comment on function public.gt_job_get(uuid) is
  'Returns one safe public topic job after checking current workspace read membership.';
comment on function public.gt_job_list(text, text) is
  'Returns safe public topic jobs for a currently active readable project.';
comment on function public.gt_job_claim(integer) is
  'Worker-only claim with SKIP LOCKED, a random fencing token, and bounded lease-expiry retries.';
comment on function public.gt_job_worker_heartbeat() is
  'Worker-only heartbeat; enqueue fails closed unless this timestamp was refreshed within the last 60 seconds.';
comment on function public.gt_job_context(uuid, uuid) is
  'Worker-only pinned input context; connection metadata excludes credential ciphertext.';
comment on function public.gt_job_heartbeat(uuid, uuid, integer) is
  'Worker-only lease extension requiring the live fencing token.';
comment on function public.gt_job_finish(uuid, uuid, jsonb) is
  'Worker-only completion guarded by project revision, current requester write membership, and lease fencing.';
comment on function public.gt_job_fail(uuid, uuid, text, text, boolean) is
  'Worker-only retry/failure transition; public errors are allowlisted and messages are generic.';