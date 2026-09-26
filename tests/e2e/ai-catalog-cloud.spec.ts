import { expect, test } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { executeConnections, type ConnectionDependencies } from '../../server/aiConnectionsApi'
import { execFile, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const migration = await readFile(
  new URL('../../supabase/migrations/20260926000300_ai_catalog.sql', import.meta.url),
  'utf8',
)
const connectionMigration = await readFile(
  new URL('../../supabase/migrations/20260926000400_ai_connections.sql', import.meta.url),
  'utf8',
)
const connectionVersionMigration = await readFile(
  new URL('../../supabase/migrations/20260926000500_ai_connections_schema_version.sql', import.meta.url),
  'utf8',
)
const api = await readFile(new URL('../../server/aiCatalogApi.ts', import.meta.url), 'utf8')
const plugin = await readFile(new URL('../../server/projectAccessPlugin.ts', import.meta.url), 'utf8')
const sql = migration.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const execFileAsync = promisify(execFile)

test('AI catalog schema is immutable and has narrowly scoped writes', () => {
  expect(sql).toContain('primary key (workspace_id, asset_id, version)')
  expect(sql).toContain('alter table public.ai_catalog_versions enable row level security')
  expect(sql).toContain('revoke all on public.ai_catalog_versions from public, anon, authenticated')
  expect(sql).toContain('grant select on public.ai_catalog_versions to authenticated')
  expect(sql).not.toMatch(/grant (insert|update|delete|all)[\s\S]*?on public\.ai_catalog_versions/)
  expect(sql).toContain('before insert or update or delete on public.ai_catalog_versions')
  expect(sql).toContain('raise exception \'ai catalog versions are immutable\'')
  expect(sql).toContain('security definer')
  expect(sql).toContain('grant execute on function public.ai_catalog_command')
  expect(sql).toContain('actor_role not in (\'owner\',\'admin\')')
  expect(sql).toContain('membership.user_id = (select auth.uid())')
  expect(sql).toContain('using (public.workspace_can(workspace_id, \'read\'))')
})

test('connections migration denies browser table reads and grants only a scoped server reader', () => {
  const text = connectionMigration.toLowerCase()
  expect(text).toContain('revoke all on public.ai_connections from public, anon, authenticated')
  expect(text).toContain('grant select (workspace_id, provider_id, revision, ciphertext, nonce, tag, key_version)')
  expect(text).toContain('to ai_connection_reader')
  expect(text).not.toMatch(/grant select[\s\S]*?on public\.ai_connections to authenticated/)
  expect(text).toContain('membership.user_id = (select auth.uid())')
  expect(text).toContain("actor_role not in ('owner','admin')")
  expect(text).toContain('for share')
  expect(text).toContain('pg_catalog.pg_advisory_xact_lock')
  expect(text).toContain('revoke all on public.ai_connection_audit from public, anon, authenticated, ai_connection_reader')
  expect(text).not.toContain('service_role')
})

test('AI Connections registers its deployed schema using the existing version pattern', () => {
  const sql = connectionVersionMigration.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase()
  expect(sql).toBe(
    "insert into public.cloud_schema_versions(component, version) values ('ai-connections', 1) on conflict (component) do update set version = excluded.version;",
  )
})

test('AI catalog RPC creates immutable versions and guards transitions and tombstones', () => {
  expect(sql).toContain('current_row.version <> p_expected_version')
  expect(sql).toContain('current_row.version + 1')
  expect(sql).toContain('next_state := case when p_action = \'delete\' then \'archived\'')
  expect(sql).toContain('latest.state <> \'archived\'')
  expect(sql).toContain('public.ai_catalog_valid_input')
  expect(sql).toContain('credential|secret|token|api.?key|password|authorization|private.?key')
  expect(sql).toContain('ai asset version changed')
  expect(sql).toContain('pg_advisory_xact_lock(hashtext(p_workspace_id::text), hashtext(p_asset_id))')
  expect(sql).toContain("jsonb_build_object('versions', history_json)")
  expect(sql).toContain("jsonb_build_object('assets', history_json)")
  expect(sql).toContain('removed prompt ids cannot be reused')
  expect(sql).toContain('new prompts must start at version 1 in draft state')
  expect(sql).toContain('for share')
  expect(sql).toContain('initial prompts must start at version 1 in draft state')
  expect(sql).toContain('ai_catalog_workflow_references_exist(p_workspace_id, p_payload->\'definition\')')
  expect(sql).toContain('target.workspace_id = p_workspace_id')
  expect(sql).toContain('target.kind = expected.kind')
})

test('same-origin endpoint verifies server identity and delegates validation to shared model', () => {
  expect(plugin).toContain("const AI_CATALOG_ENDPOINT = '/api/ai-catalog'")
  expect(plugin).toContain('isSameOriginRequest(request)')
  expect(plugin).toContain('AI catalog cloud persistence is unavailable in local mode')
  expect(api).toContain("const ACCESS_COOKIE = 'sb_access_token'")
  expect(api).toContain("this.request('/auth/v1/user')")
  expect(api).toContain('/rest/v1/workspace_memberships?')
  expect(api).toContain('validateAiAssetInput(value.asset)')
  expect(api).toContain('validateAiInitialAsset(value.asset)')
  expect(api).toContain('validateAiRevision(latest, input.asset, historyAssets)')
  expect(api).toContain('validateAiTransition(latest, input.state')
  expect(api).toContain('canTransitionAiVersion(latest.state, \'archived\')')
  expect(api).toContain('historyResult.versions')
  expect(api).toContain("input.action === 'history' ? 'versions' : 'assets'")
  expect(api).toContain("code === '40001' || code === '23505'")
  expect(api).toContain('Authorization: `Bearer ${this.token}`')
  expect(api).toContain('ai_catalog_command')
})

test('PostgreSQL integration runs in an isolated disposable local database', async () => {
  if (process.env.AI_CATALOG_SQL_TESTS !== '1') {
    test.skip(true, 'Set AI_CATALOG_SQL_TESTS=1 to opt into creating a disposable local PostgreSQL database; this gate never uses a configured application/production database URL.')
    return
  }

  const preflight = spawnSync('psql', [
    '-X', '-A', '-t', '-F', '|', '-d', 'postgres',
    '-c',
    `select current_database(),
      coalesce(inet_server_addr()::text, 'local-socket'),
      (select rolsuper from pg_roles where rolname = current_user),
      exists(select 1 from pg_roles where rolname = 'anon'),
      exists(select 1 from pg_roles where rolname = 'authenticated'),
      exists(select 1 from pg_roles where rolname = 'ai_connection_reader')`,
  ], { encoding: 'utf8', timeout: 10_000 })
  if (preflight.error || preflight.status !== 0) {
    test.skip(true, `Local PostgreSQL preflight unavailable: ${preflight.error?.message ?? preflight.stderr.trim()}`)
    return
  }
  const [database, address, isSuperuser, hadAnon, hadAuthenticated, hadReader] =
    preflight.stdout.trim().split('|')
  if (database !== 'postgres' || address !== 'local-socket' || isSuperuser !== 't') {
    test.skip(true, 'Requires a local Unix-socket PostgreSQL superuser; remote/database URLs are intentionally refused.')
    return
  }

  const testDatabase = `ai_catalog_test_${randomUUID().replaceAll('-', '')}`
  const runPsql = (args: string[], timeout = 90_000) => spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', ...args],
    { cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 },
  )
  const runPsqlAsync = async (args: string[], timeout = 15_000) => execFileAsync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args],
    { cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 },
  )
  const create = runPsql(['-d', 'postgres', '-c', `CREATE DATABASE ${testDatabase}`])
  if (create.error || create.status !== 0) {
    test.skip(true, `Could not create isolated disposable database: ${create.error?.message ?? create.stderr.trim()}`)
    return
  }

  let integrationFailure: Error | null = null
  try {
    const result = runPsql(['-d', testDatabase, '-f', 'tests/e2e/ai-catalog-cloud.integration.sql'])
    if (result.error || result.status !== 0) {
      integrationFailure = new Error(
        `PostgreSQL AI catalog integration failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
      )
    } else {
      // Exercise the actual timestamptz JSON and restricted-reader bytea round trips.
      const sqlWriter = new Client({ database: testDatabase })
      const reader = new Client({ database: testDatabase })
      try {
        await sqlWriter.connect()
        await reader.connect()
        await sqlWriter.query('set role authenticated')
        await sqlWriter.query("select set_config('request.jwt.claim.sub', $1, false)", ['20000000-0000-0000-0000-000000000001'])
        await reader.query('set role ai_connection_reader')
        const columns = ['p_action', 'p_workspace_id', 'p_provider_id', 'p_expected_revision',
          'p_ciphertext', 'p_nonce', 'p_tag', 'p_state', 'p_proof', 'p_tested_at'] as const
        const dependencies: ConnectionDependencies = {
          async command(args) {
            const response = await sqlWriter.query(
              `select public.ai_connection_command($1::text,$2::uuid,$3::text,$4::integer,$5::text,
                $6::text,$7::text,$8::text,$9::text,$10::timestamptz) as value`,
              columns.map(column => args[column] ?? null),
            )
            return response.rows[0].value as unknown
          },
          async readEncrypted(workspaceId, providerId) {
            const response = await reader.query(
              'select workspace_id, provider_id, revision, ciphertext, nonce, tag, key_version from public.ai_connections where workspace_id = $1 and provider_id = $2',
              [workspaceId, providerId],
            )
            if (!response.rows.length) return null
            const row = response.rows[0]
            return { workspaceId: row.workspace_id as string, providerId: row.provider_id as string,
              revision: row.revision as number, ciphertext: row.ciphertext as Buffer,
              nonce: row.nonce as Buffer, tag: row.tag as Buffer, keyVersion: row.key_version as string }
          },
          async verify(_providerId, credential) {
            expect(credential).toBe('isolated-sql-test-credential')
            return 'verified'
          },
        }
        const ws = '10000000-0000-0000-0000-000000000001'
        const credentialKey = randomBytes(32)
        const create = await executeConnections(
          { action: 'create', providerId: 'sql-roundtrip', credential: 'isolated-sql-test-credential' },
          ws, 'owner', credentialKey, dependencies,
        )
        expect(create).toMatchObject({ connection: { revision: 1, state: 'untested' } })
        const tested = await executeConnections(
          { action: 'test', providerId: 'sql-roundtrip', expectedRevision: 1 },
          ws, 'owner', credentialKey, dependencies,
        )
        expect(tested).toMatchObject({ connection: { state: 'verified' } })
        expect(await executeConnections({ action: 'list' }, ws, 'viewer', credentialKey, dependencies))
          .toMatchObject({ connections: [{ providerId: 'sql-roundtrip', state: 'verified' }] })
        expect(await executeConnections({ action: 'delete', providerId: 'sql-roundtrip', expectedRevision: 1 },
          ws, 'owner', credentialKey, dependencies)).toMatchObject({ deleted: true })
      } finally {
        await sqlWriter.end().catch(() => {})
        await reader.end().catch(() => {})
      }
      const writerPromise = runPsqlAsync([
        '-d', testDatabase, '-c',
        `SET ROLE authenticated;
         SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
         SELECT public.ai_catalog_command(
           'create', '10000000-0000-0000-0000-000000000001', 'revocation-race', null,
           '{"kind":"reference-set","name":"Membership lock","description":"","definition":{"entries":[]}}'::jsonb,
           null
         )`,
      ])
      const writerOutcome = writerPromise.then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      )
      let membershipLockHeld = false
      for (let attempt = 0; attempt < 150; attempt++) {
        const activity = runPsql([
          '-d', testDatabase, '-A', '-t', '-c',
          `select exists (
             select 1 from pg_locks
             where locktype = 'advisory'
               and classid = 88776655::oid
               and objid = 123456789::oid
               and objsubid = 2
               and granted
           )`,
        ], 5000)
        if (activity.error || activity.status !== 0)
          throw new Error(`Could not observe SQL integration writer: ${activity.error?.message ?? activity.stderr}`)
        if (activity.stdout.trim() === 't') {
          membershipLockHeld = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      if (!membershipLockHeld) {
        const outcome = await writerOutcome
        throw new Error(`Could not observe the mutation's transaction lock during its intentional delay: ${
          'error' in outcome ? outcome.error.message : outcome.value.stderr
        }`)
      }

      const revocationPromise = runPsqlAsync([
        '-d', testDatabase, '-c',
        `DELETE FROM public.workspace_memberships
         WHERE workspace_id = '10000000-0000-0000-0000-000000000001'
           AND user_id = '20000000-0000-0000-0000-000000000001'
         RETURNING user_id`,
      ])
      const revocationFinishedEarly = await Promise.race([
        revocationPromise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 150)),
      ])
      if (revocationFinishedEarly)
        throw new Error('Concurrent membership revocation was not blocked by the in-flight catalog mutation')

      const writer = await writerOutcome
      if ('error' in writer) throw writer.error
      expect(writer.value.stdout).toContain('revocation-race')
      const revocation = await revocationPromise
      expect(revocation.stdout).toContain('20000000-0000-0000-0000-000000000001')

      const revokedAccess = runPsql([
        '-d', testDatabase, '-c',
        `SET ROLE authenticated;
         SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
         SELECT public.ai_catalog_command('list', '10000000-0000-0000-0000-000000000001')`,
      ])
      expect(revokedAccess.status).not.toBe(0)
    }
  } finally {
    const dropDatabase = runPsql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`])
    const cleanupErrors: string[] = []
    if (dropDatabase.error || dropDatabase.status !== 0)
      cleanupErrors.push(`Disposable database cleanup failed: ${dropDatabase.error?.message ?? dropDatabase.stderr}`)
    if (hadAnon !== 't') {
      const dropAnon = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS anon'])
      if (dropAnon.error || dropAnon.status !== 0) cleanupErrors.push(`Test anon role cleanup failed: ${dropAnon.stderr}`)
    }
    if (hadAuthenticated !== 't') {
      const dropAuthenticated = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS authenticated'])
      if (dropAuthenticated.error || dropAuthenticated.status !== 0)
        cleanupErrors.push(`Test authenticated role cleanup failed: ${dropAuthenticated.stderr}`)
    }
    if (hadReader !== 't') {
      const dropReader = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS ai_connection_reader'])
      if (dropReader.error || dropReader.status !== 0)
        cleanupErrors.push(`Test connection reader role cleanup failed: ${dropReader.stderr}`)
    }
    if (cleanupErrors.length)
      integrationFailure = new Error([integrationFailure?.message, ...cleanupErrors].filter(Boolean).join('\n'))
  }
  if (integrationFailure) throw integrationFailure
  expect(true).toBe(true)
})