import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { createServer } from "node:net"
import { loadConfigFromFile } from "vite"
import packageJson from "../../package.json" with { type: "json" }
import {
  createPlaywrightRunPaths,
  findAvailableLoopbackPort,
  resolvePlaywrightRun,
} from "../../scripts/playwright-tooling.mjs"

test("Playwright runs receive isolated result and HTML report paths", () => {
  const first = createPlaywrightRunPaths("e2e", "first-run")
  const second = createPlaywrightRunPaths("e2e", "second-run")

  assert.notEqual(first.outputDir, second.outputDir)
  assert.notEqual(first.reportDir, second.reportDir)
  assert.match(first.outputDir, /\/test-results$/)
  assert.match(first.reportDir, /\/html-report$/)
  assert.throws(() => createPlaywrightRunPaths("../shared", "run"))
})

test("loopback port allocation returns a releasable IPv4 port", async () => {
  const port = await findAvailableLoopbackPort()
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535)

  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen({ host: "127.0.0.1", port }, resolveListen)
  })
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose())
  })
})

test("worker config reload inherits its invocation port and output identity", async () => {
  const configName = "worker-regression"
  const previousWorkerIndex = process.env.TEST_WORKER_INDEX
  delete process.env.TEST_WORKER_INDEX
  try {
    const firstLoad = await resolvePlaywrightRun(configName, { loopbackServer: true })
    const secondLoad = await resolvePlaywrightRun(configName, { loopbackServer: true })
    assert.deepEqual(secondLoad, firstLoad)

    const workerSource = new URL("../../scripts/playwright-tooling.mjs", import.meta.url)
    const workerScript = `
      import { createPlaywrightRunPaths, resolvePlaywrightRun } from ${JSON.stringify(workerSource.href)}
      const run = await resolvePlaywrightRun(${JSON.stringify(configName)}, { loopbackServer: true })
      console.log(JSON.stringify({ ...run, paths: createPlaywrightRunPaths(${JSON.stringify(configName)}, run.runId) }))
    `
    const worker = spawnSync(process.execPath, ["--input-type=module", "-e", workerScript], {
      encoding: "utf8",
      env: { ...process.env, TEST_WORKER_INDEX: "11" },
    })
    assert.equal(worker.status, 0, worker.stderr)
    assert.deepEqual(JSON.parse(worker.stdout), {
      ...firstLoad,
      paths: createPlaywrightRunPaths(configName, firstLoad.runId),
    })

    const cleanEnvironment = { ...process.env }
    delete cleanEnvironment.TEST_WORKER_INDEX
    delete cleanEnvironment.REPLIT_PLAYWRIGHT_WORKER_REGRESSION_RUN_ID
    delete cleanEnvironment.REPLIT_PLAYWRIGHT_WORKER_REGRESSION_SERVER_PORT
    const firstInvocation = spawnSync(process.execPath, ["--input-type=module", "-e", workerScript], {
      encoding: "utf8",
      env: cleanEnvironment,
    })
    const secondInvocation = spawnSync(process.execPath, ["--input-type=module", "-e", workerScript], {
      encoding: "utf8",
      env: cleanEnvironment,
    })
    assert.equal(firstInvocation.status, 0, firstInvocation.stderr)
    assert.equal(secondInvocation.status, 0, secondInvocation.stderr)
    const firstIndependentRun = JSON.parse(firstInvocation.stdout)
    const secondIndependentRun = JSON.parse(secondInvocation.stdout)
    assert.notEqual(firstIndependentRun.runId, secondIndependentRun.runId)
    assert.notEqual(firstIndependentRun.paths.outputDir, secondIndependentRun.paths.outputDir)
  } finally {
    if (previousWorkerIndex === undefined) delete process.env.TEST_WORKER_INDEX
    else process.env.TEST_WORKER_INDEX = previousWorkerIndex
  }
})

test("consolidated SQL-backed suite enables both gates and invokes all E2E specs", async () => {
  const runner = await readFile(new URL("../../scripts/test-postgres.sh", import.meta.url), "utf8")
  const fullMode = runner.slice(runner.indexOf("\n  full)\n"))
  const fullInvocationStart = runner.indexOf('if [[ "$full_suite" -eq 1 ]]; then', runner.indexOf("ready=0"))
  const fullInvocationEnd = runner.indexOf("\nelse\n", fullInvocationStart)
  const fullInvocation = runner.slice(fullInvocationStart, fullInvocationEnd)

  assert.equal(packageJson.scripts["test:consolidated"], "bash scripts/test-postgres.sh full")
  assert.match(fullMode, /ai_catalog_sql_tests=1/)
  assert.match(fullMode, /topic_jobs_sql_tests=1/)
  assert.match(fullInvocation, /--config=playwright\.config\.ts/)
  assert.match(fullInvocation, /--workers=1/)
  assert.match(fullInvocation, /--retries=0/)
  assert.match(fullInvocation, /\$\{full_cli_args\[@\]\}/)
  assert.doesNotMatch(fullInvocation, /--grep|tests\/e2e\/[^ ]+\.spec\.ts/)
  assert.ok(runner.includes("--reporter=*|--output=*"))
  assert.match(runner, /--reporter\|--output/)
  assert.ok(runner.includes('if [[ "${1:-}" == "--" ]]; then'))
})

test("opted-in PostgreSQL tests fail on unavailable tooling and only skip on opt-out", async () => {
  const runner = await readFile(new URL("../../scripts/test-postgres.sh", import.meta.url), "utf8")
  assert.ok(runner.includes('export PATH="$pg_bin_dir:$PATH"'))

  for (const [file, gate] of [
    ["ai-catalog-cloud.spec.ts", "AI_CATALOG_SQL_TESTS"],
    ["generate-topic-jobs-sql.spec.ts", "GENERATE_TOPIC_JOBS_SQL_TESTS"],
  ]) {
    const source = await readFile(new URL(`../../tests/e2e/${file}`, import.meta.url), "utf8")
    const skips = [...source.matchAll(/test\.skip\(/g)]
    const preflight = source.slice(source.indexOf("const preflight"))

    assert.equal(skips.length, 1, `${file} should skip only when its opt-in is disabled`)
    assert.match(source, new RegExp(`process\\.env\\.${gate} !== '1'[\\s\\S]*?test\\.skip\\(`))
    assert.doesNotMatch(preflight, /test\.skip\(/)
    assert.match(preflight, /Opted-in local PostgreSQL preflight failed/)
    assert.match(preflight, /Could not create isolated disposable database/)
  }
})

test("E2E config supplies a strict loopback server URL to browser workers", async () => {
  const config = await readFile(new URL("../../playwright.config.ts", import.meta.url), "utf8")

  assert.match(config, /await resolvePlaywrightRun\("e2e", \{ loopbackServer: true \}\)/)
  assert.match(config, /baseURL,/)
  assert.match(config, /--config vite\.acceptance\.config\.ts/)
  assert.match(config, /--port \$\{appPort\} --strictPort/)
  assert.match(config, /reuseExistingServer: false/)
})

test("acceptance Vite config disables watching and HMR without changing base plugins", async () => {
  const configEnv = {
    command: "serve",
    mode: "development",
    isSsrBuild: false,
    isPreview: false,
  }
  const base = await loadConfigFromFile(
    configEnv,
    new URL("../../vite.config.ts", import.meta.url).pathname,
  )
  const acceptance = await loadConfigFromFile(
    configEnv,
    new URL("../../vite.acceptance.config.ts", import.meta.url).pathname,
  )

  assert.ok(base)
  assert.ok(acceptance)
  assert.equal(acceptance.config.server?.watch, null)
  assert.equal(acceptance.config.server?.hmr, false)
  const pluginNames = (plugins) => plugins.flat(Infinity).filter(Boolean).map(plugin => plugin.name)
  assert.deepEqual(pluginNames(acceptance.config.plugins), pluginNames(base.config.plugins))
})