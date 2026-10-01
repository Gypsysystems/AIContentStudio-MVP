import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { resolve } from "node:path"

const invocationRuns = new Map()

function runEnvironmentKeys(configName) {
  const prefix = `REPLIT_PLAYWRIGHT_${configName.toUpperCase().replaceAll("-", "_")}`
  return {
    runId: `${prefix}_RUN_ID`,
    port: `${prefix}_SERVER_PORT`,
  }
}

export function getPlaywrightRunId(configName) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(configName)) {
    throw new Error(`Invalid Playwright config name: ${configName}`)
  }

  const keys = runEnvironmentKeys(configName)
  let run = invocationRuns.get(configName)
  if (!run) {
    const inheritedRunId = process.env[keys.runId]
    run = inheritedRunId && /^[a-z0-9-]+$/i.test(inheritedRunId)
      ? { runId: inheritedRunId }
      : { runId: randomUUID() }
    invocationRuns.set(configName, run)
    process.env[keys.runId] = run.runId
  }
  return run.runId
}

export async function resolvePlaywrightRun(configName, { loopbackServer = false } = {}) {
  const runId = getPlaywrightRunId(configName)
  let port

  if (loopbackServer) {
    const keys = runEnvironmentKeys(configName)
    const run = invocationRuns.get(configName)
    const inheritedPort = Number(process.env[keys.port])
    if (Number.isInteger(inheritedPort) && inheritedPort > 0 && inheritedPort <= 65_535) {
      run.port = inheritedPort
    }
    if (!run.port) {
      if (process.env.TEST_WORKER_INDEX !== undefined) {
        throw new Error(`Playwright worker did not inherit the ${configName} server port`)
      }
      run.portPromise ??= findAvailableLoopbackPort()
      run.port = await run.portPromise
      process.env[keys.port] = String(run.port)
    }
    port = run.port
  }

  return { runId, port }
}

export function createPlaywrightRunPaths(configName, runId = randomUUID()) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(configName)) {
    throw new Error(`Invalid Playwright config name: ${configName}`)
  }
  if (!/^[a-z0-9-]+$/i.test(runId)) {
    throw new Error("Invalid Playwright run ID")
  }

  const runDir = resolve(process.cwd(), ".playwright", "runs", configName, runId)
  return {
    outputDir: resolve(runDir, "test-results"),
    reportDir: resolve(runDir, "html-report"),
  }
}

export async function findAvailableLoopbackPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    await new Promise(resolveClose => server.close(resolveClose))
    throw new Error("Could not allocate a loopback test-server port")
  }

  const { port } = address
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose())
  })
  return port
}