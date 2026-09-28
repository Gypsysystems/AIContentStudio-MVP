import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

test('topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing', async () => {
  if (process.env.GENERATE_TOPIC_JOBS_SQL_TESTS !== '1') {
    test.skip(true, 'Set GENERATE_TOPIC_JOBS_SQL_TESTS=1 to create an isolated local disposable PostgreSQL database.')
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
      exists(select 1 from pg_roles where rolname = 'generate_topic_worker')`,
  ], { encoding: 'utf8', timeout: 10_000 })
  if (preflight.error || preflight.status !== 0) {
    test.skip(true, `Local PostgreSQL preflight unavailable: ${preflight.error?.message ?? preflight.stderr.trim()}`)
    return
  }

  const [database, address, isSuperuser, hadAnon, hadAuthenticated, hadWorker] =
    preflight.stdout.trim().split('|')
  if (database !== 'postgres' || address !== 'local-socket' || isSuperuser !== 't') {
    test.skip(true, 'Requires a local Unix-socket PostgreSQL superuser; remote/database URLs are intentionally refused.')
    return
  }
  if (hadWorker === 't') {
    test.skip(true, 'The disposable test refuses to alter a pre-existing generate_topic_worker role.')
    return
  }

  const testDatabase = `generate_topic_jobs_test_${randomUUID().replaceAll('-', '')}`
  const runPsql = (args: string[], timeout = 90_000) => spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', ...args],
    { cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 },
  )
  const runPsqlAsync = (args: string[], timeout = 15_000) => execFileAsync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args],
    { cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 },
  )

  const create = runPsql(['-d', 'postgres', '-c', `CREATE DATABASE ${testDatabase}`])
  if (create.error || create.status !== 0) {
    test.skip(true, `Could not create isolated disposable database: ${create.error?.message ?? create.stderr.trim()}`)
    return
  }

  let failure: Error | null = null
  let admin: Client | undefined
  let owner: Client | undefined
  let editor: Client | undefined
  let viewer: Client | undefined
  let outsider: Client | undefined
  let worker: Client | undefined
  try {
    const setup = runPsql(['-d', testDatabase, '-f', 'tests/e2e/generate-topic-jobs.integration.sql'])
    if (setup.error || setup.status !== 0) {
      throw new Error(`Disposable topic-jobs SQL setup failed:\n${setup.stdout}\n${setup.stderr}`)
    }

    admin = new Client({ database: testDatabase })
    owner = new Client({ database: testDatabase })
    editor = new Client({ database: testDatabase })
    viewer = new Client({ database: testDatabase })
    outsider = new Client({ database: testDatabase })
    worker = new Client({ database: testDatabase })
    await Promise.all([admin, owner, editor, viewer, outsider, worker].map(client => client!.connect()))

    const configureUser = async (client: Client, userId: string) => {
      await client.query('set role authenticated')
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    }
    await configureUser(owner, '20000000-0000-0000-0000-000000000001')
    await configureUser(editor, '20000000-0000-0000-0000-000000000002')
    await configureUser(viewer, '20000000-0000-0000-0000-000000000003')
    await configureUser(outsider, '20000000-0000-0000-0000-000000000004')

    const asWorker = async () => {
      await worker!.query('set session authorization generate_topic_worker')
    }
    const enqueue = async (
      client: Client, topicId: string, workflowId = 'wf-exact', workflowVersion = 3, revision = 7,
    ) => {
      const response = await client.query(
        `select public.gt_job_enqueue($1::text, $2::text, $3::text, $4::integer, $5::bigint) as value`,
        ['project-a', topicId, workflowId, workflowVersion, revision],
      )
      return response.rows[0].value as { job: Record<string, unknown> }
    }
    const callWorker = async (sql: string, values: unknown[] = []) => {
      const response = await worker!.query(sql, values)
      return response.rows[0]?.value as Record<string, any> | undefined
    }
    const expectCode = async (operation: () => Promise<unknown>, code: string) => {
      let caught: unknown
      try {
        await operation()
      } catch (error) {
        caught = error
      }
      expect((caught as { code?: string } | undefined)?.code).toBe(code)
    }

    await expectCode(() => enqueue(owner, 'topic-a'), '55000')
    await admin.query(
      `insert into public.generate_topic_worker_heartbeats(worker_name, heartbeat_at)
       values ('generate_topic_worker', clock_timestamp() - interval '61 seconds')`,
    )
    await expectCode(() => enqueue(owner, 'topic-a'), '55000')

    await asWorker()
    const initialBeat = await callWorker('select public.gt_job_worker_heartbeat() as value')
    expect(initialBeat?.heartbeatAt).toBeTruthy()
    await worker!.query('reset session authorization')

    const first = await enqueue(owner, 'topic-a')
    const duplicate = await enqueue(owner, 'topic-a')
    const firstId = first.job.jobId as string
    expect(duplicate.job.jobId).toBe(firstId)
    expect(first.job).toMatchObject({
      projectId: 'project-a', topicId: 'topic-a',
      workflowId: 'wf-exact', workflowVersion: 3, inputRevision: 7, status: 'queued',
    })
    await expectCode(() => enqueue(owner, 'topic-a', 'wf-other', 1), '23505')
    await expectCode(() => enqueue(owner, 'topic-a', 'wf-exact', 2), 'P0002')
    await expectCode(() => enqueue(owner, 'topic-a', 'wf-foreign', 1), 'P0002')
    await expectCode(() => enqueue(viewer, 'topic-a'), '42501')

    const listed = await viewer.query(
      'select public.gt_job_list($1::text, $2::text) as value', ['project-a', 'topic-a'],
    )
    expect(listed.rows[0].value.jobs).toHaveLength(1)
    expect(listed.rows[0].value.jobs[0]).not.toHaveProperty('idempotencyKey')
    await expectCode(
      () => outsider.query('select public.gt_job_get($1::uuid)', [firstId]),
      'P0002',
    )
    await expectCode(
      () => viewer.query('select job_id from public.generate_topic_jobs'),
      '42501',
    )

    await asWorker()
    const claimedFirst = await callWorker('select public.gt_job_claim(120) as value')
    expect(claimedFirst?.job.jobId).toBe(firstId)
    const firstToken = claimedFirst?.leaseToken as string
    const contextResult = await callWorker(
      'select public.gt_job_context($1::uuid, $2::uuid) as value',
      [firstId, firstToken],
    )
    expect(contextResult?.record.privateProjectMarker).toBe('worker-only-record')
    expect(contextResult?.assets.workflow.id).toBe('wf-exact')
    expect(contextResult?.assets.workflow.version).toBe(3)
    expect(contextResult?.connectionMetadata).toEqual({
      providerId: 'provider-a', revision: 4, state: 'verified',
      proof: 'a'.repeat(64),
      testedAt: expect.any(String),
    })
    expect(new Date(contextResult?.connectionMetadata.testedAt as string).toISOString())
      .toBe('2026-09-28T12:34:56.000Z')
    expect(JSON.stringify(contextResult)).not.toContain('never-return-this')
    const finishedFirst = await callWorker(
      'select public.gt_job_finish($1::uuid, $2::uuid, $3::jsonb) as value',
      [firstId, firstToken, JSON.stringify({ title: 'Generated topic', body: 'Safe result.' })],
    )
    expect(finishedFirst?.job.status).toBe('succeeded')
    await worker!.query('reset session authorization')

    const publicSucceeded = await viewer.query(
      'select public.gt_job_get($1::uuid) as value', [firstId],
    )
    expect(publicSucceeded.rows[0].value.job).toMatchObject({
      jobId: firstId, status: 'succeeded',
      draft: { title: 'Generated topic', body: 'Safe result.' },
    })
    expect(JSON.stringify(publicSucceeded.rows[0].value)).not.toContain('worker-only-record')
    expect(publicSucceeded.rows[0].value.job).not.toHaveProperty('requesterId')
    expect(publicSucceeded.rows[0].value.job).not.toHaveProperty('leaseToken')
    expect(publicSucceeded.rows[0].value.job).not.toHaveProperty('proof')
    expect(publicSucceeded.rows[0].value.job).not.toHaveProperty('testedAt')
    const succeededRerun = await enqueue(owner, 'topic-a')
    expect(succeededRerun.job.status).toBe('queued')
    expect(succeededRerun.job.jobId).not.toBe(firstId)
    expect((await enqueue(owner, 'topic-a')).job.jobId).toBe(succeededRerun.job.jobId)
    await asWorker()
    const claimedRerun = await callWorker('select public.gt_job_claim(120) as value')
    expect(claimedRerun?.job.jobId).toBe(succeededRerun.job.jobId)
    const failedRerun = await callWorker(
      'select public.gt_job_fail($1::uuid, $2::uuid, $3::text, $4::text, $5::boolean) as value',
      [succeededRerun.job.jobId, claimedRerun?.leaseToken, 'GENERATION_FAILED', 'ignored', false],
    )
    expect(failedRerun?.job.status).toBe('failed')
    await worker!.query('reset session authorization')

    const jobB = await enqueue(owner, 'topic-b')
    const jobC = await enqueue(owner, 'topic-c')
    const idB = jobB.job.jobId as string
    const idC = jobC.job.jobId as string

    await admin.query('begin')
    await admin.query('select job_id from public.generate_topic_jobs where job_id = $1 for update', [idB])
    await asWorker()
    const skippedClaim = await callWorker('select public.gt_job_claim(120) as value')
    expect(skippedClaim?.job.jobId).toBe(idC)
    await admin.query('commit')
    const finishedC = await callWorker(
      'select public.gt_job_finish($1::uuid, $2::uuid, $3::jsonb) as value',
      [idC, skippedClaim?.leaseToken, JSON.stringify({ title: 'C' })],
    )
    expect(finishedC?.job.status).toBe('succeeded')

    const claimB1 = await callWorker('select public.gt_job_claim(120) as value')
    expect(claimB1?.job.jobId).toBe(idB)
    const tokenB1 = claimB1?.leaseToken as string
    await admin.query(
      `update public.generate_topic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where job_id = $1`,
      [idB],
    )
    const claimB2 = await callWorker('select public.gt_job_claim(120) as value')
    const tokenB2 = claimB2?.leaseToken as string
    expect(claimB2?.job.jobId).toBe(idB)
    expect(claimB2?.job.attemptCount).toBe(2)
    expect(tokenB2).not.toBe(tokenB1)
    await expectCode(
      () => callWorker('select public.gt_job_heartbeat($1::uuid, $2::uuid, 120) as value', [idB, tokenB1]),
      '40001',
    )
    await expectCode(
      () => callWorker(
        'select public.gt_job_finish($1::uuid, $2::uuid, $3::jsonb) as value',
        [idB, tokenB1, JSON.stringify({ title: 'stolen' })],
      ),
      '40001',
    )
    const retryWait = await callWorker(
      'select public.gt_job_fail($1::uuid, $2::uuid, $3::text, $4::text, $5::boolean) as value',
      [idB, tokenB2, 'RATE_LIMITED', 'unsafe provider detail must not escape', true],
    )
    expect(retryWait?.job.status).toBe('retry-wait')
    expect(retryWait?.job.errorMessage).toBeUndefined()
    expect(JSON.stringify(retryWait)).not.toContain('unsafe provider detail')
    await admin.query(
      'update public.generate_topic_jobs set next_attempt_at = clock_timestamp() - interval \'1 second\' where job_id = $1',
      [idB],
    )
    const claimB3 = await callWorker('select public.gt_job_claim(120) as value')
    expect(claimB3?.job.jobId).toBe(idB)
    expect(claimB3?.job.attemptCount).toBe(3)
    const exhausted = await callWorker(
      'select public.gt_job_fail($1::uuid, $2::uuid, $3::text, $4::text, $5::boolean) as value',
      [idB, claimB3?.leaseToken, 'RATE_LIMITED', 'ignored', true],
    )
    expect(exhausted?.job.status).toBe('failed')
    expect(exhausted?.job.errorCode).toBe('RATE_LIMITED')
    await worker!.query('reset session authorization')
    const failedRerunB = await enqueue(owner, 'topic-b')
    expect(failedRerunB.job.status).toBe('queued')
    expect(failedRerunB.job.jobId).not.toBe(idB)
    expect((await enqueue(owner, 'topic-b')).job.jobId).toBe(failedRerunB.job.jobId)
    await admin.query(
      "update public.generate_topic_jobs set next_attempt_at = clock_timestamp() + interval '1 hour' where job_id = $1",
      [failedRerunB.job.jobId],
    )

    const staleProjectJob = await enqueue(owner, 'topic-d')
    await asWorker()
    const staleProjectClaim = await callWorker('select public.gt_job_claim(120) as value')
    expect(staleProjectClaim?.job.jobId).toBe(staleProjectJob.job.jobId)
    await admin.query(
      'update public.cloud_projects set record_revision = 8 where project_id = $1',
      ['project-a'],
    )
    const staleProjectResult = await callWorker(
      'select public.gt_job_finish($1::uuid, $2::uuid, $3::jsonb) as value',
      [staleProjectJob.job.jobId, staleProjectClaim?.leaseToken, JSON.stringify({ title: 'stale' })],
    )
    expect(staleProjectResult?.job).toMatchObject({
      status: 'failed', errorCode: 'STALE_PROJECT',
      errorMessage: 'The project changed before generation could be saved.',
    })
    expect(staleProjectResult?.job).not.toHaveProperty('draft')
    await worker!.query('reset session authorization')

    const revokedJob = await enqueue(owner, 'topic-e', 'wf-exact', 3, 8)
    await asWorker()
    const revokedClaim = await callWorker('select public.gt_job_claim(120) as value')
    expect(revokedClaim?.job.jobId).toBe(revokedJob.job.jobId)
    await admin.query(
      `delete from public.workspace_memberships
       where workspace_id = '10000000-0000-0000-0000-000000000001'
         and user_id = '20000000-0000-0000-0000-000000000001'`,
    )
    const revokedResult = await callWorker(
      'select public.gt_job_finish($1::uuid, $2::uuid, $3::jsonb) as value',
      [revokedJob.job.jobId, revokedClaim?.leaseToken, JSON.stringify({ title: 'revoked' })],
    )
    expect(revokedResult?.job).toMatchObject({
      status: 'failed', errorCode: 'PERMISSION_REVOKED',
    })
    expect(revokedResult?.job).not.toHaveProperty('draft')
    await worker!.query('reset session authorization')
    await expectCode(
      () => owner.query('select public.gt_job_get($1::uuid)', [revokedJob.job.jobId]),
      'P0002',
    )
    await admin.query(
      `insert into public.workspace_memberships(workspace_id, user_id, role)
       values ('10000000-0000-0000-0000-000000000001',
         '20000000-0000-0000-0000-000000000001', 'owner')`,
    )
    const editorCanReadFailed = await editor.query(
      'select public.gt_job_get($1::uuid) as value', [revokedJob.job.jobId],
    )
    expect(editorCanReadFailed.rows[0].value.job.errorCode).toBe('PERMISSION_REVOKED')

  } catch (error) {
    failure = error as Error
  } finally {
    await Promise.all([worker, outsider, viewer, editor, owner, admin]
      .filter((client): client is Client => Boolean(client))
      .map(client => client.end().catch(() => undefined)))
    const dropDatabase = runPsql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`])
    const cleanupErrors: string[] = []
    if (dropDatabase.error || dropDatabase.status !== 0) {
      cleanupErrors.push(`Disposable database cleanup failed: ${dropDatabase.error?.message ?? dropDatabase.stderr}`)
    }
    if (hadWorker !== 't') {
      const dropWorker = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS generate_topic_worker'])
      if (dropWorker.error || dropWorker.status !== 0) cleanupErrors.push(`Worker role cleanup failed: ${dropWorker.stderr}`)
    }
    if (hadAnon !== 't') {
      const dropAnon = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS anon'])
      if (dropAnon.error || dropAnon.status !== 0) cleanupErrors.push(`Test anon role cleanup failed: ${dropAnon.stderr}`)
    }
    if (hadAuthenticated !== 't') {
      const dropAuthenticated = runPsql(['-d', 'postgres', '-c', 'DROP ROLE IF EXISTS authenticated'])
      if (dropAuthenticated.error || dropAuthenticated.status !== 0) {
        cleanupErrors.push(`Test authenticated role cleanup failed: ${dropAuthenticated.stderr}`)
      }
    }
    if (cleanupErrors.length) {
      failure = new Error([failure?.message, ...cleanupErrors].filter(Boolean).join('\n'))
    }
  }
  if (failure) throw failure
  expect(true).toBe(true)
})