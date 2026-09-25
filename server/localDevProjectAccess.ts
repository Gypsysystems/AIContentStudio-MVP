import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
  LOCAL_USER_ID,
  LOCAL_WORKSPACE_ID,
  type MembershipRole,
  type ProjectOwnership,
} from '../src/ownership'
import type {
  MembershipLookupResult,
  ProjectOwnershipDirectory,
  VerifiedSession,
  VerifiedSessionVerifier,
  WorkspaceMembershipLookup,
} from './projectAccess'
import { createProjectAccessService } from './projectAccess'

const LOCAL_ROLE: MembershipRole = 'owner'
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 10_000
const STALE_LOCK_AGE_MS = 30_000

interface MetadataLockRecord {
  pid: number
  token: string
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** A server-generated local session. It does not inspect request headers or cookies. */
export class LocalDevSessionVerifier implements VerifiedSessionVerifier {
  async verify(_request: IncomingMessage): Promise<VerifiedSession> {
    return {
      userId: LOCAL_USER_ID,
      activeWorkspaceId: LOCAL_WORKSPACE_ID,
      expiresAt: Date.now() + 60_000,
    }
  }
}

/** Local membership lookup remains server-owned and is consulted on every request. */
export class LocalDevMembershipLookup implements WorkspaceMembershipLookup {
  async lookup(userId: string, workspaceId: string): Promise<MembershipLookupResult> {
    if (userId !== LOCAL_USER_ID || workspaceId !== LOCAL_WORKSPACE_ID) return { status: 'missing' }
    return { status: 'active', role: LOCAL_ROLE }
  }
}

/**
 * Persists ownership metadata only. It intentionally stores no IndexedDB
 * contents or blobs. Existing legacy IDB rows imported here are only enrolled
 * under local ownership; this operation cannot establish their actual IDB
 * provenance.
 */
export class JsonFileProjectOwnershipDirectory implements ProjectOwnershipDirectory {
  private readonly filePath: string
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async get(projectId: string): Promise<ProjectOwnership | null> {
    const entries = await this.readAll()
    const ownership = entries[projectId]
    return ownership ? { ...ownership } : null
  }

  async listByWorkspace(workspaceId: string): Promise<string[]> {
    const entries = await this.readAll()
    return Object.entries(entries)
      .filter(([, ownership]) => ownership.workspaceId === workspaceId)
      .map(([projectId]) => projectId)
      .sort()
  }

  async insert(projectId: string, ownership: ProjectOwnership): Promise<boolean> {
    return this.mutate(async (entries) => {
      if (Object.prototype.hasOwnProperty.call(entries, projectId)) return false
      entries[projectId] = { ...ownership }
      return true
    })
  }

  async insertMany(
    entriesToAdd: ReadonlyArray<{ projectId: string; ownership: ProjectOwnership }>,
  ): Promise<boolean> {
    return this.mutate(async (entries) => {
      if (entriesToAdd.some(({ projectId }) => Object.prototype.hasOwnProperty.call(entries, projectId))) return false
      for (const { projectId, ownership } of entriesToAdd) entries[projectId] = { ...ownership }
      return true
    })
  }

  async remove(projectId: string): Promise<void> {
    await this.mutate(async (entries) => {
      if (!Object.prototype.hasOwnProperty.call(entries, projectId)) return true
      delete entries[projectId]
      return true
    })
  }

  private async readAll(): Promise<Record<string, ProjectOwnership>> {
    let content: string
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null) as Record<string, ProjectOwnership>
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('Local project ownership metadata JSON is invalid')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Local project ownership metadata must be a JSON object')
    }

    const result = Object.create(null) as Record<string, ProjectOwnership>
    for (const [projectId, value] of Object.entries(parsed)) {
      if (typeof value !== 'object'
        || value === null
        || typeof (value as ProjectOwnership).ownerUserId !== 'string'
        || typeof (value as ProjectOwnership).workspaceId !== 'string') {
        throw new Error(`Invalid ownership metadata for project "${projectId}"`)
      }
      result[projectId] = {
        ownerUserId: (value as ProjectOwnership).ownerUserId,
        workspaceId: (value as ProjectOwnership).workspaceId,
      }
    }
    return result
  }

  private async mutate(change: (entries: Record<string, ProjectOwnership>) => Promise<boolean>): Promise<boolean> {
    let result = false
    const operation = this.mutationQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await this.withInterprocessLock(async () => {
        const entries = await this.readAll()
        result = await change(entries)
        if (!result) return
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(
            temporaryPath,
            `${JSON.stringify(entries, null, 2)}\n`,
            { encoding: 'utf8', mode: 0o600, flag: 'wx' },
          )
          await rename(temporaryPath, this.filePath)
        } finally {
          await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        }
      })
    })
    this.mutationQueue = operation.catch(() => undefined)
    await operation
    return result
  }

  private async withInterprocessLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined
    let token = ''

    while (!lockHandle) {
      token = randomUUID()
      try {
        lockHandle = await open(lockPath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await this.removeStaleLock(lockPath)
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for project metadata lock: ${lockPath}`)
        }
        await delay(LOCK_RETRY_MS)
        continue
      }
      try {
        await lockHandle.writeFile(JSON.stringify({ pid: process.pid, token } satisfies MetadataLockRecord), 'utf8')
        await lockHandle.sync()
      } catch (error) {
        await lockHandle.close().catch(() => undefined)
        lockHandle = undefined
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<MetadataLockRecord>
          if (current.token === token && current.pid === process.pid) await unlink(lockPath)
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError
        }
        throw error
      }
    }

    try {
      return await operation()
    } finally {
      try {
        await lockHandle.close()
      } finally {
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<MetadataLockRecord>
          if (current.token === token && current.pid === process.pid) await unlink(lockPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
  }

  private async removeStaleLock(lockPath: string): Promise<void> {
    let initialStat
    let record: Partial<MetadataLockRecord> | undefined
    try {
      initialStat = await stat(lockPath)
      if (Date.now() - initialStat.mtimeMs < STALE_LOCK_AGE_MS) return
      record = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<MetadataLockRecord>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      // A malformed lock is reclaimable only after it has exceeded the stale age.
      if (!initialStat || Date.now() - initialStat.mtimeMs < STALE_LOCK_AGE_MS) return
    }

    const pid = record?.pid
    if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return
      }
    }

    // Recheck the observed inode and age so a refreshed lock is not removed.
    try {
      const currentStat = await stat(lockPath)
      if (initialStat
        && (currentStat.dev !== initialStat.dev
          || currentStat.ino !== initialStat.ino
          || currentStat.mtimeMs !== initialStat.mtimeMs)) return
      if (Date.now() - currentStat.mtimeMs >= STALE_LOCK_AGE_MS) await unlink(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Build the dev-only service against persistent metadata beneath the repo root. */
export function createLocalDevProjectAccessService(rootDirectory = process.cwd()) {
  const projectDirectory = new JsonFileProjectOwnershipDirectory(
    path.join(rootDirectory, '.local', 'project-access-metadata.json'),
  )
  return createProjectAccessService({
    sessionVerifier: new LocalDevSessionVerifier(),
    membershipLookup: new LocalDevMembershipLookup(),
    projectDirectory,
    localImportEnabled: true,
    localUserId: LOCAL_USER_ID,
    localWorkspaceId: LOCAL_WORKSPACE_ID,
  })
}