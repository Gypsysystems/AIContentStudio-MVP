import { expect, test, type Page } from '@playwright/test'
import type { ProjectAccessContext } from '../../src/ownership'

async function openApp(page: Page) {
  await page.goto('/')
}

test('local session owns migrated v3 records in the default workspace', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { authSessionService, LocalDevAuthSessionAdapter } =
      await import('/src/authSession.ts' as string)
    const id = `ownership-v3-migration-${Date.now()}`
    const seed = await projectRepository.createProject({ projectId: id, projectName: 'Legacy owner' })
    const legacy = { ...seed, schemaVersion: 3 }
    delete (legacy as Record<string, unknown>).ownerUserId
    delete (legacy as Record<string, unknown>).workspaceId
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put(legacy)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Fixture seed aborted'))
    })
    db.close()

    const loaded = await projectRepository.loadProject(id)
    const adapter = new LocalDevAuthSessionAdapter()
    return {
      loaded,
      session: authSessionService.getSession(),
      adapterContext: adapter.getAccessContext(),
    }
  })

  expect(result.session.user.id).toBe('local-user')
  expect(result.session.workspace.id).toBe('local-workspace')
  expect(result.adapterContext).toMatchObject({
    user: { id: 'local-user' },
    workspace: { id: 'local-workspace' },
    membership: { userId: 'local-user', workspaceId: 'local-workspace', role: 'owner' },
  })
  expect(result.loaded).toMatchObject({
    schemaVersion: 4,
    ownerUserId: 'local-user',
    workspaceId: 'local-workspace',
  })
})

test('downgraded owners cannot bypass role permissions and foreign schemas do not break listings', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, restoreProjectBackup } = await import('/src/projectBackup.ts' as string)
    const owner: ProjectAccessContext = {
      user: { id: 'downgraded-owner' }, workspace: { id: 'workspace-visible' },
      membership: { userId: 'downgraded-owner', workspaceId: 'workspace-visible', role: 'owner' },
    }
    const viewer: ProjectAccessContext = {
      ...owner, membership: { ...owner.membership, role: 'viewer' },
    }
    const foreign: ProjectAccessContext = {
      user: { id: 'foreign-owner' }, workspace: { id: 'workspace-future' },
      membership: { userId: 'foreign-owner', workspaceId: 'workspace-future', role: 'owner' },
    }
    const created = await projectRepository.createProject({
      projectId: `downgraded-owner-${Date.now()}`, projectName: 'Still visible',
    }, owner)
    const archive = await createProjectBackup(created.projectId, owner)
    const attempt = async (fn: () => Promise<unknown>) => {
      try { await fn(); return false } catch { return true }
    }
    const denied = await Promise.all([
      attempt(() => projectRepository.saveProjectIfCurrent({
        ...created, projectName: 'Should not change',
      }, created.recordRevision, viewer)),
      attempt(() => projectRepository.deleteProject(created.projectId, viewer)),
      attempt(() => projectRepository.duplicateProject(created.projectId, 'Illicit copy', viewer)),
      attempt(() => restoreProjectBackup(archive, {
        mode: 'replace', expectedRevision: created.recordRevision, expectedFileIds: [],
      }, viewer)),
    ])
    const foreignProject = await projectRepository.createProject({
      projectId: `foreign-future-${Date.now()}`, projectName: 'Incompatible',
    }, foreign)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('docflow-db')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put({ ...foreignProject, schemaVersion: 999 })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    const listed = await projectRepository.listProjects(owner)
    return {
      denied, viewerCanRead: !!(await projectRepository.loadProject(created.projectId, viewer)),
      listedIds: listed.map((item: { projectId: string }) => item.projectId),
      original: await projectRepository.loadProject(created.projectId, owner),
      foreignId: foreignProject.projectId,
    }
  })
  expect(result.denied).toEqual([true, true, true, true])
  expect(result.viewerCanRead).toBe(true)
  expect(result.listedIds).toContain(result.original?.projectId)
  expect(result.listedIds).not.toContain(result.foreignId)
  expect(result.original).toMatchObject({ projectName: 'Still visible', recordRevision: 0 })
})

test('workspace owner, member, editor, and viewer permissions are enforced by repository operations', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { PROJECT_PERMISSIONS, authorizeWorkspace } = await import('/src/ownership.ts' as string)
    const { createProjectBackup, restoreProjectBackup } =
      await import('/src/projectBackup.ts' as string)
    const workspace = { id: `permission-workspace-${Date.now()}` }
    const context = (
      userId: string,
      role: 'owner' | 'admin' | 'editor' | 'viewer',
    ): ProjectAccessContext => ({
      user: { id: userId },
      workspace,
      membership: { userId, workspaceId: workspace.id, role },
    })
    const owner = context('project-owner', 'owner')
    const memberOwner = context('workspace-admin', 'admin')
    const editor = context('workspace-editor', 'editor')
    const viewer = context('workspace-viewer', 'viewer')
    const id = `permission-matrix-${Date.now()}`
    await projectRepository.createProject({ projectId: id, projectName: 'Permission matrix' }, owner)
    const file = await projectRepository.saveFile(id, new File(['permission bytes'], 'asset.txt'), owner)

    const attempt = async (operation: () => unknown) => {
      try {
        await operation()
        return { rejected: false, message: '' }
      } catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) }
      }
    }
    const allowed = async (roleContext: ProjectAccessContext) => {
      const record = await projectRepository.loadProject(id, roleContext)
      if (!record) throw new Error('Expected permitted project read')
      return {
        read: true,
        backup: !!(await createProjectBackup(id, roleContext)),
        fileRead: !!(await projectRepository.loadFile(file.fileId, roleContext)),
      }
    }
    const writeAttempt = async (roleContext: ProjectAccessContext) => {
      const record = await projectRepository.loadProject(id, roleContext)
      if (!record) throw new Error('Missing project during write check')
      return attempt(() => projectRepository.saveProjectIfCurrent(
        { ...record, projectName: `Written by ${roleContext.user.id}` },
        record.recordRevision,
        roleContext,
      ))
    }

    const ownerRead = await allowed(owner)
    const memberRead = await allowed(memberOwner)
    const editorRead = await allowed(editor)
    const viewerRead = await allowed(viewer)
    const ownerWrite = await writeAttempt(owner)
    const memberWrite = await writeAttempt(memberOwner)
    const editorWrite = await writeAttempt(editor)
    const viewerWrite = await writeAttempt(viewer)
    const editorDuplicate = await attempt(() =>
      projectRepository.duplicateProject(id, 'Editor copy', editor))
    const viewerDuplicate = await attempt(() =>
      projectRepository.duplicateProject(id, 'Viewer copy', viewer))
    const editorCreate = await attempt(() => projectRepository.createProject({
      projectId: `editor-created-${Date.now()}`, projectName: 'Editor created',
    }, editor))
    const viewerCreate = await attempt(() => projectRepository.createProject({
      projectId: `viewer-created-${Date.now()}`, projectName: 'Viewer created',
    }, viewer))
    const viewerRemove = await attempt(() => projectRepository.removeFile(file.fileId, viewer))
    const editorRemove = await attempt(() => projectRepository.removeFile(file.fileId, editor))
    const viewerDelete = await attempt(() => projectRepository.deleteProject(id, viewer))
    const editorDelete = await attempt(() => projectRepository.deleteProject(id, editor))
    const editorArchive = await createProjectBackup(id, owner)
    const editorRestore = await attempt(() =>
      restoreProjectBackup(editorArchive, { mode: 'new', newName: 'Permission matrix editor restore' }, editor))
    const roleMatrix = Object.fromEntries(
      [owner, memberOwner, editor, viewer].map(roleContext => [
        roleContext.membership.role,
        PROJECT_PERMISSIONS.filter(permission => {
          try {
            authorizeWorkspace(roleContext, permission)
            return true
          } catch {
            return false
          }
        }),
      ]),
    )
    const adminProjectId = `admin-delete-${Date.now()}`
    await projectRepository.createProject({
      projectId: adminProjectId, projectName: 'Admin delete permission',
    }, owner)
    const ownerDelete = await attempt(() => projectRepository.deleteProject(id, owner))
    const adminDelete = await attempt(() => projectRepository.deleteProject(adminProjectId, memberOwner))
    return {
      ownerRead, memberRead, editorRead, viewerRead,
      ownerWrite, memberWrite, editorWrite, viewerWrite,
      editorDuplicate, viewerDuplicate, editorCreate, viewerCreate,
      viewerRemove, editorRemove, viewerDelete, editorDelete, editorRestore,
      roleMatrix, ownerDelete, adminDelete,
    }
  })

  for (const read of [result.ownerRead, result.memberRead, result.editorRead, result.viewerRead]) {
    expect(read).toEqual({ read: true, backup: true, fileRead: true })
  }
  for (const write of [result.ownerWrite, result.memberWrite, result.editorWrite]) {
    expect(write.rejected).toBe(false)
  }
  expect(result.viewerWrite.rejected).toBe(true)
  expect(result.editorDuplicate.rejected).toBe(false)
  expect(result.viewerDuplicate.rejected).toBe(true)
  expect(result.editorCreate.rejected).toBe(false)
  expect(result.viewerCreate.rejected).toBe(true)
  expect(result.viewerRemove.rejected).toBe(true)
  expect(result.editorRemove.rejected).toBe(false)
  expect(result.viewerDelete.rejected).toBe(true)
  expect(result.editorDelete.rejected).toBe(true)
  expect(result.editorRestore.rejected).toBe(false)
  expect(result.roleMatrix).toEqual({
    owner: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
    admin: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
    editor: ['create', 'read', 'write', 'duplicate', 'backup', 'restore-new'],
    viewer: ['read', 'backup'],
  })
  expect(result.ownerDelete.rejected).toBe(false)
  expect(result.adminDelete.rejected).toBe(false)
})

test('forged identities and cross-workspace contexts cannot read, write, delete, or access files/backups', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup } = await import('/src/projectBackup.ts' as string)
    const { serializeProjectBackup } = await import('/src/projectBackup.ts' as string)
    const owner: ProjectAccessContext = {
      user: { id: `owner-${Date.now()}` },
      workspace: { id: `workspace-a-${Date.now()}` },
      membership: { userId: '', workspaceId: '', role: 'owner' },
    }
    owner.membership = {
      userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner',
    }
    const foreign: ProjectAccessContext = {
      user: { id: `foreign-${Date.now()}` },
      workspace: { id: `workspace-b-${Date.now()}` },
      membership: { userId: '', workspaceId: '', role: 'owner' },
    }
    foreign.membership = {
      userId: foreign.user.id, workspaceId: foreign.workspace.id, role: 'owner',
    }
    const forged: ProjectAccessContext = {
      ...foreign, membership: { ...foreign.membership, userId: 'forged-user' },
    }
    const id = `cross-workspace-${Date.now()}`
    await projectRepository.createProject({ projectId: id, projectName: 'Workspace A project' }, owner)
    const file = await projectRepository.saveFile(id, new File(['private'], 'private.txt'), owner)
    const attempt = async (operation: () => unknown) => {
      try { await operation(); return { rejected: false, message: '' } }
      catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) }
      }
    }
    const record = await projectRepository.loadProject(id, owner)
    if (!record) throw new Error('Owner cannot read seed')
    const foreignAttempts = await Promise.all([
      attempt(() => projectRepository.loadProject(id, foreign)),
      attempt(() => projectRepository.saveProjectIfCurrent(
        { ...record, projectName: 'forged overwrite' }, record.recordRevision, foreign,
      )),
      attempt(() => projectRepository.deleteProject(id, foreign)),
      attempt(() => projectRepository.saveFile(id, new File(['attack'], 'attack.txt'), foreign)),
      attempt(() => projectRepository.loadFile(file.fileId, foreign)),
      attempt(() => projectRepository.loadProjectFiles(id, foreign)),
      attempt(() => projectRepository.removeFile(file.fileId, foreign)),
      attempt(() => createProjectBackup(id, foreign)),
      attempt(() => projectRepository.loadProject(id, forged)),
    ])
    const foreignListing = await projectRepository.listProjects(foreign)
    const ownerListing = await projectRepository.listProjects(owner)
    const snapshot = await projectRepository.loadProjectSnapshot(id, owner)
    if (!snapshot) throw new Error('Owner cannot load snapshot')
    const archive = await serializeProjectBackup(snapshot)
    const backupAttempt = await attempt(() => createProjectBackup(id, owner))
    return {
      id, fileId: file.fileId, foreignAttempts, backupAttempt,
      foreignIds: foreignListing.map((project: { projectId: string }) => project.projectId),
      ownerIds: ownerListing.map((project: { projectId: string }) => project.projectId),
      archiveSize: archive.size,
      after: await projectRepository.loadProject(id, owner),
      fileIds: (await projectRepository.loadProjectFiles(id, owner))
        .map((stored: { fileId: string }) => stored.fileId),
    }
  })

  expect(result.foreignAttempts).toHaveLength(9)
  for (const attempt of result.foreignAttempts) expect(attempt.rejected).toBe(true)
  expect(result.backupAttempt.rejected).toBe(false)
  expect(result.archiveSize).toBeGreaterThan(0)
  expect(result.foreignIds).not.toContain(result.id)
  expect(result.ownerIds).toContain(result.id)
  expect(result.after).toMatchObject({ projectName: 'Workspace A project' })
  expect(result.fileIds).toEqual([result.fileId])
})

test('duplicate and restore assign actor ownership; denied and cross-workspace restores are atomic', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, restoreProjectBackup, serializeProjectBackup } =
      await import('/src/projectBackup.ts' as string)
    const context = (
      userId: string,
      workspaceId: string,
      role: 'owner' | 'admin' | 'editor' | 'viewer',
    ): ProjectAccessContext => ({
      user: { id: userId },
      workspace: { id: workspaceId },
      membership: { userId, workspaceId, role },
    })
    const sourceOwner = context(`source-owner-${Date.now()}`, `source-workspace-${Date.now()}`, 'owner')
    const actor = context(`actor-${Date.now()}`, `actor-workspace-${Date.now()}`, 'editor')
    const manager = context(actor.user.id, actor.workspace.id, 'admin')
    const viewer = context(`viewer-${Date.now()}`, actor.workspace.id, 'viewer')
    const sourceId = `restore-source-${Date.now()}`
    const source = await projectRepository.createProject({
      projectId: sourceId, projectName: 'Restorable source',
    }, sourceOwner)
    const sourceFile = await projectRepository.saveFile(
      sourceId, new File(['archived content'], 'archive.txt'), sourceOwner,
    )
    const archive = await createProjectBackup(sourceId, sourceOwner)
    const sourceMember = context(`source-member-${Date.now()}`, sourceOwner.workspace.id, 'editor')
    const duplicate = await projectRepository.duplicateProject(sourceId, 'Source copy', sourceMember)
    if (!duplicate) throw new Error('Owner duplicate unexpectedly missing')
    const restored = await restoreProjectBackup(archive, {
      mode: 'new', newName: 'Restorable source actor restore',
    }, actor)
    const restoredFiles = await projectRepository.loadProjectFiles(restored.projectId, actor)

    const destinationId = `restore-destination-${Date.now()}`
    const destination = await projectRepository.createProject({
      projectId: destinationId, projectName: 'Protected destination',
    }, actor)
    const destinationFile = await projectRepository.saveFile(
      destinationId, new File(['destination bytes'], 'destination.txt'), actor,
    )
    const current = await projectRepository.saveProjectIfCurrent({
      ...destination, sourceFileIds: [destinationFile.fileId],
    }, destination.recordRevision, actor)
    const destinationSnapshot = await projectRepository.loadProjectSnapshot(destinationId, actor)
    if (!destinationSnapshot) throw new Error('Destination snapshot missing')
    const foreignRecord = {
      ...destinationSnapshot.record,
      projectName: 'Foreign replacement attempt',
      ownerUserId: sourceOwner.user.id,
      workspaceId: sourceOwner.workspace.id,
    }
    const sameWorkspaceArchive = await serializeProjectBackup(destinationSnapshot)
    const foreignArchive = await serializeProjectBackup({
      ...destinationSnapshot,
      record: foreignRecord as any,
    })
    const attempt = async (operation: () => unknown) => {
      try { await operation(); return { rejected: false, message: '' } }
      catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) }
      }
    }
    const deniedNew = await attempt(() => restoreProjectBackup(archive, {
      mode: 'new', newName: 'Restorable source viewer restore',
    }, viewer))
    const deniedReplace = await attempt(() => restoreProjectBackup(foreignArchive, {
      mode: 'replace',
      expectedRevision: current.recordRevision,
      expectedFileIds: [destinationFile.fileId],
    }, manager))
    const roleDeniedReplace = await attempt(() => restoreProjectBackup(sameWorkspaceArchive, {
      mode: 'replace',
      expectedRevision: current.recordRevision,
      expectedFileIds: [destinationFile.fileId],
    }, actor))
    const afterDenied = await projectRepository.loadProject(destinationId, actor)
    const filesAfterDenied = await projectRepository.loadProjectFiles(destinationId, actor)
    const replaced = await restoreProjectBackup(sameWorkspaceArchive, {
      mode: 'replace',
      expectedRevision: current.recordRevision,
      expectedFileIds: [destinationFile.fileId],
    }, manager)
    const after = await projectRepository.loadProject(destinationId, actor)
    const afterFiles = await projectRepository.loadProjectFiles(destinationId, actor)
    const list = await projectRepository.listProjects(actor)
    return {
      source, sourceFile, duplicate, restored, restoredFiles,
      deniedNew, deniedReplace, roleDeniedReplace, afterDenied,
      filesAfterDeniedIds: filesAfterDenied.map((file: { fileId: string }) => file.fileId),
      replaced, after,
      afterFileText: await afterFiles[0]?.blob.text(),
      afterFileIds: afterFiles.map((file: { fileId: string }) => file.fileId),
      sourceMember, actor, listCount: list.length,
      sourceId, destinationId,
      destinationFileId: destinationFile.fileId,
    }
  })

  expect(result.duplicate).toMatchObject({
    ownerUserId: result.sourceMember.user.id,
    workspaceId: result.source.workspaceId,
  })
  expect(result.duplicate.ownerUserId).not.toBe(result.source.ownerUserId)
  expect(result.restored).toMatchObject({
    ownerUserId: expect.stringContaining('actor-'),
    workspaceId: expect.stringContaining('actor-workspace-'),
  })
  expect(result.restored.ownerUserId).toBe(result.actor.user.id)
  expect(result.restored.workspaceId).toBe(result.actor.workspace.id)
  expect(result.restored.ownerUserId).not.toBe(result.source.ownerUserId)
  expect(result.restoredFiles).toHaveLength(1)
  expect(result.restoredFiles[0].fileId).not.toBe(result.sourceFile.fileId)
  expect(result.deniedNew.rejected).toBe(true)
  expect(result.deniedReplace.rejected).toBe(true)
  expect(result.roleDeniedReplace.rejected).toBe(true)
  expect(result.afterDenied).toMatchObject({
    projectName: 'Protected destination',
    recordRevision: 1,
    ownerUserId: result.actor.user.id,
    workspaceId: result.actor.workspace.id,
  })
  expect(result.filesAfterDeniedIds).toEqual([result.destinationFileId])
  expect(result.replaced).toMatchObject({
    ownerUserId: result.actor.user.id,
    workspaceId: result.actor.workspace.id,
    recordRevision: 2,
  })
  expect(result.after).toMatchObject({
    projectId: result.destinationId,
    projectName: 'Protected destination',
    recordRevision: result.after.recordRevision,
    ownerUserId: result.actor.user.id,
    workspaceId: result.actor.workspace.id,
  })
  expect(result.afterFileIds).toHaveLength(1)
  expect(result.afterFileText).toBe('destination bytes')
  expect(result.listCount).toBe(2)
})