import { createHash, randomUUID } from "node:crypto"
import { spawn, execFile as execFileCallback } from "node:child_process"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import {
  createPlaywrightRunPaths,
  findAvailableLoopbackPort,
} from "./playwright-tooling.mjs"

const execFile = promisify(execFileCallback)

export const SQL_TEST_TITLES = Object.freeze([
  "PostgreSQL integration runs in an isolated disposable local database",
  "topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing",
])

const HUMAN_REPORTERS = new Set(["dot", "github", "line", "list"])
const RUN_ID_PATTERN = /^[a-z0-9-]+$/i
const DEFAULT_EXCLUDED_PREFIXES = [".playwright/runs/", "docs/", ".agents/memory/"]

function usage() {
  return [
    "Usage: pnpm test:parallel -- [--workers N] [--repeat-each N] [--reporter NAME]",
    "The full E2E inventory runs with zero retries; only the two opted-in PostgreSQL titles",
    "are excluded from the browser run and are then run separately by scripts/test-postgres.sh.",
  ].join("\n")
}

function parsePositiveInteger(value, optionName) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${optionName} must be a positive integer.`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${optionName} must be a positive integer.`)
  }
  return number
}

export function parseParallelArguments(argv) {
  const args = [...argv]
  if (args[0] === "--") args.shift()

  const options = { workers: 2, repeatEach: 1, reporter: undefined }
  const seen = new Set()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const equalsIndex = argument.indexOf("=")
    const option = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex)
    let value = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1)

    if (!["--workers", "--repeat-each", "--reporter"].includes(option)) {
      throw new Error(`Unsupported argument ${JSON.stringify(argument)}. Only workers, repeat, and reporter options are accepted.`)
    }
    if (seen.has(option)) throw new Error(`${option} may only be specified once.`)
    seen.add(option)

    if (value === undefined) {
      value = args[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${option} requires a value.`)
      }
      index += 1
    }
    if (value.length === 0) throw new Error(`${option} requires a value.`)

    if (option === "--workers") {
      options.workers = parsePositiveInteger(value, option)
      if (options.workers < 2) throw new Error("--workers must be at least 2 for parallel runs.")
    } else if (option === "--repeat-each") {
      options.repeatEach = parsePositiveInteger(value, option)
    } else {
      if (!HUMAN_REPORTERS.has(value)) {
        throw new Error(`Unsupported human reporter ${JSON.stringify(value)}. Choose one of: ${[...HUMAN_REPORTERS].sort().join(", ")}.`)
      }
      options.reporter = value
    }
  }

  return options
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function createSqlExclusionPattern() {
  const alternatives = SQL_TEST_TITLES.map(escapeRegularExpression).join("|")
  return new RegExp(`(?:^|\\s)(?:${alternatives})$`)
}

export function buildBrowserArguments(options) {
  const { workers, repeatEach, reporter = "list" } = options
  if (!Number.isSafeInteger(workers) || workers < 2) {
    throw new Error("Browser runs require at least 2 workers.")
  }
  if (!Number.isSafeInteger(repeatEach) || repeatEach < 1) {
    throw new Error("Repeat count must be a positive integer.")
  }
  if (!HUMAN_REPORTERS.has(reporter)) {
    throw new Error(`Unsupported human reporter ${JSON.stringify(reporter)}.`)
  }

  const exclusion = createSqlExclusionPattern()
  const reporters = [...new Set(["json", "html", reporter])].join(",")
  const args = [
    "exec",
    "playwright",
    "test",
    "--config=playwright.config.ts",
    `--workers=${workers}`,
    "--retries=0",
    `--repeat-each=${repeatEach}`,
    `--grep-invert=/${exclusion.source}/`,
    `--reporter=${reporters}`,
  ]
  return args
}

function buildSqlArguments(reporter = "list") {
  if (!HUMAN_REPORTERS.has(reporter)) {
    throw new Error(`Unsupported human reporter ${JSON.stringify(reporter)}.`)
  }
  const reporters = [...new Set(["json", "html", reporter])].join(",")
  return [
    "scripts/test-postgres.sh",
    "all",
    `--reporter=${reporters}`,
    "--retries=0",
  ]
}

export function createParallelRunPlan({ runId, port, options }) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid parallel run ID.")
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid loopback server port.")
  }

  const browserPaths = createPlaywrightRunPaths("e2e", runId)
  const sqlPaths = createPlaywrightRunPaths("sql", runId)
  const browserJsonPath = resolve(dirname(browserPaths.outputDir), "results.json")
  const sqlJsonPath = resolve(dirname(sqlPaths.outputDir), "results.json")
  return {
    runId,
    port,
    evidencePath: resolve(dirname(browserPaths.outputDir), "evidence.json"),
    browser: {
      command: { executable: "pnpm", args: buildBrowserArguments(options) },
      outputDir: browserPaths.outputDir,
      reportDir: browserPaths.reportDir,
      jsonPath: browserJsonPath,
      transformCacheDir: resolve(dirname(browserPaths.outputDir), "transform-cache"),
    },
    sql: {
      command: { executable: "bash", args: buildSqlArguments(options.reporter ?? "list") },
      outputDir: sqlPaths.outputDir,
      reportDir: sqlPaths.reportDir,
      jsonPath: sqlJsonPath,
    },
  }
}

function normalizeRelativePath(filePath, cwd) {
  const absolutePath = resolve(cwd, filePath)
  return relative(cwd, absolutePath).split(sep).join("/")
}

function isExcludedPath(filePath, excludedPrefixes) {
  return excludedPrefixes.some(prefix => filePath.startsWith(prefix))
}

export async function fingerprintFiles(
  filePaths,
  { cwd = process.cwd(), excludedPrefixes = DEFAULT_EXCLUDED_PREFIXES } = {},
) {
  const paths = [...new Set(filePaths.map(filePath => normalizeRelativePath(filePath, cwd)))]
    .filter(filePath => !isExcludedPath(filePath, excludedPrefixes))
    .filter(filePath => !(filePath.toLowerCase().endsWith(".md") && !filePath.includes("/")))
    .sort()
  const fingerprint = createHash("sha256")
  fingerprint.update("parallel-test-code-input-v1\0")

  for (const filePath of paths) {
    fingerprint.update(filePath)
    fingerprint.update("\0")
    try {
      const content = await readFile(resolve(cwd, filePath))
      fingerprint.update("file\0")
      fingerprint.update(createHash("sha256").update(content).digest())
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      fingerprint.update("missing\0")
    }
  }

  return { algorithm: "sha256", digest: fingerprint.digest("hex"), fileCount: paths.length }
}

export function summarizePlaywrightReport(report) {
  if (!report || !report.stats || !Array.isArray(report.suites)) {
    throw new Error("Playwright JSON report has an unexpected structure.")
  }
  const summary = {}
  for (const key of ["expected", "skipped", "unexpected", "flaky"]) {
    if (!Number.isSafeInteger(report.stats[key]) || report.stats[key] < 0) {
      throw new Error(`Playwright JSON report is missing a valid ${key} count.`)
    }
    summary[key] = report.stats[key]
  }

  const files = new Set()
  let retriedAttempts = 0
  const visit = suites => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        if (typeof spec.file === "string") files.add(spec.file)
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            if (Number.isInteger(result.retry) && result.retry > 0) retriedAttempts += 1
          }
        }
      }
      visit(suite.suites ?? [])
    }
  }
  visit(report.suites)
  return {
    ...summary,
    retriedAttempts,
    fileCount: files.size,
  }
}

export function createPlaywrightRunEnvironment(runId, port, baseEnvironment = process.env) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid parallel run ID.")
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid loopback server port.")
  }
  return {
    ...baseEnvironment,
    REPLIT_PLAYWRIGHT_E2E_RUN_ID: runId,
    REPLIT_PLAYWRIGHT_E2E_SERVER_PORT: String(port),
    REPLIT_PLAYWRIGHT_SQL_RUN_ID: runId,
    PWTEST_CACHE_DIR: resolve(dirname(createPlaywrightRunPaths("e2e", runId).outputDir), "transform-cache"),
    // Playwright's supported compatibility path avoids Node 22 synchronous
    // load-hook source validation. Scope this to owned test invocations only.
    PLAYWRIGHT_FORCE_ASYNC_LOADER: "1",
  }
}

export async function fingerprintRepository(cwd = process.cwd()) {
  const { stdout } = await execFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  return fingerprintFiles(stdout.split("\0").filter(Boolean), { cwd })
}

async function captureRepositoryState(cwd) {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }),
    execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" }),
  ])
  return {
    baseRevision: revision.trim(),
    dirtyState: {
      isDirty: status.length > 0,
      porcelainV1: status,
    },
  }
}

function commandRecord(executable, args) {
  return { executable, args: [...args] }
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1
}

function signalOwnedChild(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}

function installSignalHandlers() {
  const state = { signal: null, child: null, forceKillTimer: null }
  const handlers = new Map()

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (state.signal) return
      state.signal = signal
      if (state.child) {
        try {
          signalOwnedChild(state.child, signal)
        } catch (error) {
          console.error(`Could not forward ${signal} to the owned test process: ${error.message}`)
        }
        state.forceKillTimer = setTimeout(() => {
          if (state.child) {
            try {
              signalOwnedChild(state.child, "SIGKILL")
            } catch (error) {
              console.error(`Could not stop the owned test process: ${error.message}`)
            }
          }
        }, 8_000)
        state.forceKillTimer.unref()
      }
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }

  return {
    state,
    dispose() {
      for (const [signal, handler] of handlers) process.off(signal, handler)
      if (state.forceKillTimer) clearTimeout(state.forceKillTimer)
    },
  }
}

async function runOwnedCommand(command, { cwd, env, signalState }) {
  if (signalState.signal) return { exitCode: signalExitCode(signalState.signal), signal: signalState.signal }
  console.log(`\n$ ${JSON.stringify([command.executable, ...command.args])}`)

  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    })
    signalState.child = child
    let spawnError

    child.once("error", error => {
      spawnError = error
    })
    child.once("close", (code, signal) => {
      signalState.child = null
      if (signalState.forceKillTimer) {
        clearTimeout(signalState.forceKillTimer)
        signalState.forceKillTimer = null
      }
      if (spawnError) {
        rejectRun(spawnError)
        return
      }
      resolveRun({
        exitCode: signalState.signal
          ? signalExitCode(signalState.signal)
          : code ?? (signal ? signalExitCode(signal) : 1),
        signal: signalState.signal ?? signal ?? undefined,
      })
    })

    if (signalState.signal) {
      try {
        signalOwnedChild(child, signalState.signal)
      } catch (error) {
        console.error(`Could not forward ${signalState.signal} to the owned test process: ${error.message}`)
      }
    }
  })
}

async function writeEvidence(evidencePath, evidence) {
  const temporaryPath = `${evidencePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, evidencePath)
}

async function attachRunArtifacts(result, { jsonPath, reportDir }) {
  const reportErrors = []
  let summary = null
  try {
    const jsonReport = JSON.parse(await readFile(jsonPath, "utf8"))
    summary = summarizePlaywrightReport(jsonReport)
  } catch (error) {
    reportErrors.push(`JSON report unavailable or invalid: ${error.message}`)
  }

  let htmlAvailable = false
  try {
    htmlAvailable = (await stat(join(reportDir, "index.html"))).isFile()
  } catch {
    reportErrors.push("HTML report index.html was not produced.")
  }

  const attached = {
    ...result,
    summary,
    reports: {
      json: jsonPath,
      html: reportDir,
      htmlIndex: join(reportDir, "index.html"),
      htmlAvailable,
    },
    reportErrors,
  }
  if (result.exitCode === 0 && reportErrors.length > 0) {
    attached.processExitCode = 0
    attached.exitCode = 1
  }
  return attached
}

async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseParallelArguments(argv)
  } catch (error) {
    console.error(`${error.message}\n\n${usage()}`)
    return 2
  }

  const cwd = process.cwd()
  let repositoryState
  let codeInputFingerprint
  try {
    ;[repositoryState, codeInputFingerprint] = await Promise.all([
      captureRepositoryState(cwd),
      fingerprintRepository(cwd),
    ])
  } catch (error) {
    console.error(`Could not capture reproducible test-input evidence: ${error.message}`)
    return 1
  }

  let port
  try {
    port = await findAvailableLoopbackPort()
  } catch (error) {
    console.error(`Could not allocate an isolated loopback port: ${error.message}`)
    return 1
  }

  const runId = randomUUID()
  const plan = createParallelRunPlan({ runId, port, options })
  const signalHandlers = installSignalHandlers()
  const startedAt = new Date().toISOString()
  const browserCommand = plan.browser.command
  const sqlCommand = plan.sql.command
  const evidence = {
    schemaVersion: 1,
    runId,
    startedAt,
    status: "running",
    cwd,
    baseRevision: repositoryState.baseRevision,
    dirtyState: repositoryState.dirtyState,
    codeInputFingerprint,
    endCodeInputFingerprint: null,
    inputChangedDuringRun: null,
    options,
    server: { host: "127.0.0.1", port },
    excludedSqlTestTitles: [...SQL_TEST_TITLES],
    commands: {
      runner: { executable: process.execPath, args: process.argv.slice(1) },
      browser: commandRecord(browserCommand.executable, browserCommand.args),
      sql: commandRecord(sqlCommand.executable, sqlCommand.args),
    },
    artifacts: {
      evidence: plan.evidencePath,
      browser: {
        outputDir: plan.browser.outputDir,
        reportDir: plan.browser.reportDir,
        jsonReport: plan.browser.jsonPath,
        transformCache: plan.browser.transformCacheDir,
      },
      sql: {
        outputDir: plan.sql.outputDir,
        reportDir: plan.sql.reportDir,
        jsonReport: plan.sql.jsonPath,
        transformCacheScope: "private disposable PostgreSQL helper directory",
      },
    },
    results: { browser: null, sql: null },
  }

  try {
    await mkdir(dirname(plan.evidencePath), { recursive: true })
    await mkdir(plan.browser.outputDir, { recursive: true })
    await mkdir(plan.browser.transformCacheDir, { recursive: true, mode: 0o700 })
    await mkdir(plan.sql.outputDir, { recursive: true })
    await writeEvidence(plan.evidencePath, evidence)
    console.log(`Parallel test run ${runId}`)
    console.log(`Evidence: ${plan.evidencePath}`)

    const env = createPlaywrightRunEnvironment(runId, port)

    try {
      const browserProcessResult = await runOwnedCommand(browserCommand, {
        cwd,
        env: {
          ...env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: plan.browser.jsonPath,
          PLAYWRIGHT_HTML_OUTPUT_DIR: plan.browser.reportDir,
          PLAYWRIGHT_HTML_OPEN: "never",
        },
        signalState: signalHandlers.state,
      })
      evidence.results.browser = await attachRunArtifacts(browserProcessResult, {
        jsonPath: plan.browser.jsonPath,
        reportDir: plan.browser.reportDir,
      })
    } catch (error) {
      evidence.results.browser = { exitCode: 1, error: error.message }
    }
    evidence.status = signalHandlers.state.signal ? "interrupted" : "browser-complete"
    evidence.browserFinishedAt = new Date().toISOString()
    await writeEvidence(plan.evidencePath, evidence)

    if (!signalHandlers.state.signal) {
      console.log("\nRunning opted-in PostgreSQL tests separately with the disposable-database helper.")
      try {
        const sqlProcessResult = await runOwnedCommand(sqlCommand, {
          cwd,
          env: {
            ...env,
            PLAYWRIGHT_JSON_OUTPUT_FILE: plan.sql.jsonPath,
            PLAYWRIGHT_HTML_OUTPUT_DIR: plan.sql.reportDir,
            PLAYWRIGHT_HTML_OPEN: "never",
          },
          signalState: signalHandlers.state,
        })
        evidence.results.sql = await attachRunArtifacts(sqlProcessResult, {
          jsonPath: plan.sql.jsonPath,
          reportDir: plan.sql.reportDir,
        })
      } catch (error) {
        evidence.results.sql = { exitCode: 1, error: error.message }
      }
    } else {
      evidence.results.sql = { exitCode: signalExitCode(signalHandlers.state.signal), skipped: true }
    }

    try {
      evidence.endCodeInputFingerprint = await fingerprintRepository(cwd)
      evidence.inputChangedDuringRun =
        evidence.codeInputFingerprint.digest !== evidence.endCodeInputFingerprint.digest
    } catch (error) {
      evidence.endFingerprintError = error.message
    }

    evidence.finishedAt = new Date().toISOString()
    evidence.status = signalHandlers.state.signal
      ? "interrupted"
      : evidence.results.browser.exitCode === 0
        && evidence.results.sql.exitCode === 0
        && evidence.inputChangedDuringRun === false
        ? "passed"
        : "failed"
    await writeEvidence(plan.evidencePath, evidence)
    console.log(`\nRun status: ${evidence.status}`)
    console.log(`Browser report: ${plan.browser.reportDir}`)
    console.log(`PostgreSQL report: ${plan.sql.reportDir}`)
    console.log(`Evidence: ${plan.evidencePath}`)
    if (evidence.inputChangedDuringRun === true) {
      console.error("Code inputs changed during the run; results are flagged and the invocation fails.")
    } else if (evidence.endFingerprintError) {
      console.error(`Could not capture the end code-input fingerprint: ${evidence.endFingerprintError}`)
    }
    for (const [label, result] of Object.entries(evidence.results)) {
      if (result?.summary) {
        console.log(`${label} summary: ${JSON.stringify(result.summary)}`)
      }
      for (const reportError of result?.reportErrors ?? []) {
        console.error(`${label} report: ${reportError}`)
      }
    }

    if (signalHandlers.state.signal) return signalExitCode(signalHandlers.state.signal)
    return evidence.results.browser.exitCode
      || evidence.results.sql.exitCode
      || (evidence.inputChangedDuringRun === false ? 0 : 1)
  } finally {
    signalHandlers.dispose()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}