import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import packageJson from "../../package.json" with { type: "json" }
import {
  buildBrowserArguments,
  createPlaywrightRunEnvironment,
  createParallelRunPlan,
  createSqlExclusionPattern,
  fingerprintFiles,
  parseParallelArguments,
  SQL_TEST_TITLES,
  summarizePlaywrightReport,
} from "../../scripts/test-parallel.mjs"
import {
  createPlaywrightRunPaths,
  getPlaywrightRunId,
  resolvePlaywrightRun,
} from "../../scripts/playwright-tooling.mjs"

test("browser and disposable SQL invocations own their compiler caches", async () => {
  const options = parseParallelArguments([])
  const first = createParallelRunPlan({ runId: "cache-first", port: 32123, options })
  const second = createParallelRunPlan({ runId: "cache-second", port: 32124, options })
  assert.notEqual(first.browser.transformCacheDir, second.browser.transformCacheDir)
  assert.equal(
    createPlaywrightRunEnvironment("cache-first", 32123, { PWTEST_CACHE_DIR: "/shared-cache" }).PWTEST_CACHE_DIR,
    first.browser.transformCacheDir,
  )
  const sql = await readFile(new URL("../../scripts/test-postgres.sh", import.meta.url), "utf8")
  assert.ok(sql.includes('export PWTEST_CACHE_DIR="$work_dir/playwright-transform-cache"'))
  assert.ok(sql.includes('rm -rf -- "$work_dir"'))
})

test("parallel runner accepts only worker, repeat, and reporter options", () => {
  assert.deepEqual(parseParallelArguments([]), {
    workers: 2,
    repeatEach: 1,
    reporter: undefined,
  })
  assert.deepEqual(parseParallelArguments([
    "--",
    "--workers=6",
    "--repeat-each",
    "3",
    "--reporter=list",
  ]), {
    workers: 6,
    repeatEach: 3,
    reporter: "list",
  })

  for (const args of [
    ["--workers=1"],
    ["--workers=two"],
    ["--repeat-each=0"],
    ["--grep=some-test"],
    ["--grep-invert=some-test"],
    ["--retries=0"],
    ["--test-match=some-file"],
    ["tests/e2e/one.spec.ts"],
    ["--workers=3", "--workers=4"],
    ["--reporter=html"],
  ]) {
    assert.throws(() => parseParallelArguments(args), undefined, JSON.stringify(args))
  }
})

test("browser grep-invert excludes exactly the two opted-in SQL titles", () => {
  assert.deepEqual(SQL_TEST_TITLES, [
    "PostgreSQL integration runs in an isolated disposable local database",
    "topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing",
  ])
  const exclude = createSqlExclusionPattern()
  assert.equal(SQL_TEST_TITLES.length, 2)
  for (const title of SQL_TEST_TITLES) {
    assert.equal(exclude.test(`tests/e2e/some-sql-file.spec.ts › ${title}`), true)
  }

  assert.equal(
    exclude.test("tests/e2e/ai-catalog-cloud.spec.ts › a different PostgreSQL integration test"),
    false,
  )
  assert.equal(
    exclude.test("tests/e2e/ai-catalog-cloud.spec.ts › PostgreSQL integration runs in an isolated disposable local database setup"),
    false,
  )
  assert.equal(
    exclude.test("tests/e2e/generate-topic-jobs-sql.spec.ts › another RPC behavior test"),
    false,
  )
})

test("browser retries are fixed at zero and SQL remains a serial disposable-helper run", async () => {
  const browserArgs = buildBrowserArguments({ workers: 6, repeatEach: 2 })
  assert.ok(browserArgs.includes("--config=playwright.config.ts"))
  assert.ok(browserArgs.includes("--workers=6"))
  assert.ok(browserArgs.includes("--retries=0"))
  assert.ok(browserArgs.includes("--repeat-each=2"))
  assert.equal(browserArgs.filter(argument => argument.startsWith("--grep-invert=")).length, 1)
  assert.equal(browserArgs.filter(argument => argument.startsWith("--reporter=")).length, 1)
  assert.ok(browserArgs.includes("--reporter=json,html,list"))
  assert.equal(browserArgs.some(argument => argument.startsWith("tests/")), false)
  assert.equal(packageJson.scripts["test:parallel"], "node scripts/test-parallel.mjs")

  const playwrightConfig = await readFile(new URL("../../playwright.config.ts", import.meta.url), "utf8")
  assert.match(playwrightConfig, /--config vite\.acceptance\.config\.ts/)
  assert.match(playwrightConfig, /--port \$\{appPort\} --strictPort/)

  const postgresRunner = await readFile(new URL("../../scripts/test-postgres.sh", import.meta.url), "utf8")
  assert.match(postgresRunner, /sql_grep='PostgreSQL integration runs in an isolated disposable local database\|topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing'/)
  assert.match(postgresRunner, /--workers=1/)
  assert.match(postgresRunner, /--retries=0/)
  assert.match(postgresRunner, /--config=playwright\.sql\.config\.ts/)
  assert.match(postgresRunner, /--grep="\$sql_grep"/)
  assert.match(postgresRunner, /"\$\{sql_specs\[@\]\}"/)
  const sqlInvocation = createParallelRunPlan({
    runId: "sql-flags",
    port: 42_003,
    options: { workers: 4, repeatEach: 1 },
  }).sql.command.args
  assert.ok(sqlInvocation.includes("--retries=0"))
  assert.ok(sqlInvocation.includes("--reporter=json,html,list"))
  assert.match(postgresRunner, /work_dir="\$\(mktemp -d \/tmp\/figma-pgtest\./)
  assert.match(postgresRunner, /"\$pg_bin_dir\/initdb"/)
  assert.match(postgresRunner, /"\$pg_bin_dir\/postgres"[\s\S]*?-D "\$data_dir"/)
  assert.match(postgresRunner, /listen_addresses=''/)

  const sqlConfig = await readFile(new URL("../../playwright.sql.config.ts", import.meta.url), "utf8")
  assert.match(sqlConfig, /fullyParallel: false/)
  assert.match(sqlConfig, /workers: 1/)
})

test("runner identity uses the exact prefixes consumed by config and workers", async () => {
  const plan = createParallelRunPlan({
    runId: "prefix-run",
    port: 42_004,
    options: { workers: 4, repeatEach: 1 },
  })
  const environment = createPlaywrightRunEnvironment(plan.runId, plan.port, {})
  assert.deepEqual(environment, {
    REPLIT_PLAYWRIGHT_E2E_RUN_ID: plan.runId,
    REPLIT_PLAYWRIGHT_E2E_SERVER_PORT: String(plan.port),
    REPLIT_PLAYWRIGHT_SQL_RUN_ID: plan.runId,
    PWTEST_CACHE_DIR: plan.browser.transformCacheDir,
  })

  const keys = [
    "REPLIT_PLAYWRIGHT_E2E_RUN_ID",
    "REPLIT_PLAYWRIGHT_E2E_SERVER_PORT",
    "REPLIT_PLAYWRIGHT_SQL_RUN_ID",
    "PWTEST_CACHE_DIR",
    "REPL_PLAYWRIGHT_E2E_RUN_ID",
    "REPL_PLAYWRIGHT_E2E_SERVER_PORT",
    "REPL_PLAYWRIGHT_SQL_RUN_ID",
    "TEST_WORKER_INDEX",
  ]
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(environment)) process.env[key] = value
    delete process.env.REPL_PLAYWRIGHT_E2E_RUN_ID
    delete process.env.REPL_PLAYWRIGHT_E2E_SERVER_PORT
    delete process.env.REPL_PLAYWRIGHT_SQL_RUN_ID
    process.env.TEST_WORKER_INDEX = "7"

    const browserRun = await resolvePlaywrightRun("e2e", { loopbackServer: true })
    assert.deepEqual(browserRun, { runId: plan.runId, port: plan.port })
    assert.deepEqual(createPlaywrightRunPaths("e2e", browserRun.runId), {
      outputDir: plan.browser.outputDir,
      reportDir: plan.browser.reportDir,
    })
    assert.equal(getPlaywrightRunId("sql"), plan.runId)
    assert.deepEqual(createPlaywrightRunPaths("sql", getPlaywrightRunId("sql")), {
      outputDir: plan.sql.outputDir,
      reportDir: plan.sql.reportDir,
    })
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("Playwright report summary counts outcomes, retries, and unique test files", () => {
  const summary = summarizePlaywrightReport({
    stats: { expected: 3, skipped: 1, unexpected: 2, flaky: 1 },
    suites: [{
      specs: [
        {
          file: "tests/e2e/one.spec.ts",
          tests: [{ results: [{ retry: 0 }, { retry: 1 }] }],
        },
        { file: "tests/e2e/one.spec.ts", tests: [{ results: [{ retry: 0 }] }] },
      ],
      suites: [{
        specs: [{
          file: "tests/e2e/two.spec.ts",
          tests: [{ results: [{ retry: 2 }] }],
        }],
      }],
    }],
  })
  assert.deepEqual(summary, {
    expected: 3,
    skipped: 1,
    unexpected: 2,
    flaky: 1,
    retriedAttempts: 2,
    fileCount: 2,
  })
})

test("code-input fingerprints ignore documentation but retain runtime, test, config, SQL, and site inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "parallel-fingerprint-"))
  try {
    const codePaths = [
      "src/runtime.ts",
      "tests/e2e/check.spec.ts",
      "playwright.config.ts",
      "supabase/migrations/001.sql",
      "public/index.html",
    ]
    const documentationPaths = ["docs/guide.md", ".agents/memory/notes.txt", "README.md"]
    for (const filePath of [...codePaths, ...documentationPaths]) {
      const path = join(directory, filePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${filePath} initial\n`)
    }

    const allPaths = [...codePaths, ...documentationPaths]
    const initial = await fingerprintFiles(allPaths, { cwd: directory })
    const reordered = await fingerprintFiles([...allPaths].reverse(), { cwd: directory })
    assert.deepEqual(reordered, initial)
    assert.equal(initial.fileCount, codePaths.length)

    for (const filePath of documentationPaths) {
      await writeFile(join(directory, filePath), `${filePath} documentation-only edit\n`)
    }
    const documentationOnlyChange = await fingerprintFiles(allPaths, { cwd: directory })
    assert.equal(documentationOnlyChange.digest, initial.digest)

    await writeFile(join(directory, "src/runtime.ts"), "export const changed = true\n")
    const changed = await fingerprintFiles(allPaths, { cwd: directory })
    assert.notEqual(changed.digest, initial.digest)
    assert.equal(changed.fileCount, codePaths.length)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("independent invocations receive distinct browser, SQL, and evidence paths", () => {
  const first = createParallelRunPlan({
    runId: "parallel-run-one",
    port: 42_001,
    options: { workers: 4, repeatEach: 1 },
  })
  const second = createParallelRunPlan({
    runId: "parallel-run-two",
    port: 42_002,
    options: { workers: 8, repeatEach: 2, reporter: "list" },
  })

  assert.notEqual(first.port, second.port)
  assert.notEqual(first.evidencePath, second.evidencePath)
  assert.notEqual(first.browser.outputDir, second.browser.outputDir)
  assert.notEqual(first.browser.reportDir, second.browser.reportDir)
  assert.notEqual(first.sql.outputDir, second.sql.outputDir)
  assert.notEqual(first.sql.reportDir, second.sql.reportDir)
  assert.notEqual(first.browser.jsonPath, second.browser.jsonPath)
  assert.notEqual(first.sql.jsonPath, second.sql.jsonPath)
  assert.notEqual(first.browser.jsonPath, first.browser.outputDir)
  assert.notEqual(first.sql.jsonPath, first.sql.outputDir)
  assert.equal(dirname(first.browser.jsonPath), dirname(first.browser.outputDir))
  assert.equal(dirname(first.sql.jsonPath), dirname(first.sql.outputDir))
  assert.deepEqual(first.sql.command, {
    executable: "bash",
    args: [
      "scripts/test-postgres.sh",
      "all",
      "--reporter=json,html,list",
      "--retries=0",
    ],
  })
  assert.ok(first.evidencePath.endsWith("/evidence.json"))
})