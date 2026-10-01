import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { safeWorkerLog } from './workerSafeLogging.ts'

// Node's native TypeScript support requires explicit extensions. Resolve the
// existing extensionless server imports without adding a TS runtime package.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/iu.test(specifier) && context.parentURL) {
      try {
        const candidate = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(candidate)))
          return nextResolve(`${specifier}.ts`, context)
      } catch {
        // Preserve Node's normal resolution error for non-file specifiers.
      }
    }
    return nextResolve(specifier, context)
  },
})

let worker
try {
  const { GenerateTopicWorker } = await import('./generateTopicWorker.ts')
  worker = new GenerateTopicWorker()
  const shutdown = () => worker.stop()
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await worker.run()
} catch {
  safeWorkerLog('error', 'worker.fatal_exit', {
    errorCode: 'WORKER_STARTUP_FAILED',
  })
  process.exitCode = 1
}
