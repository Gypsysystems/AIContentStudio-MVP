import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdministrationScreen from '../../src/AdministrationScreen'
import type { MembershipRole, ProjectAccessContext } from '../../src/ownership'

export function mountAdministration(role: MembershipRole, ownershipWorkspaceId: string, id: string,
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle'): void {
  const root = document.createElement('div')
  root.id = id
  document.body.append(root)
  const context: ProjectAccessContext = {
    user: { id: 'current' },
    workspace: { id: 'workspace' },
    membership: { userId: 'current', workspaceId: 'workspace', role },
  }
  createRoot(root).render(createElement(AdministrationScreen, {
    context, mode: 'cloud', organizationName: 'Verified org', workspaceName: 'Verified workspace', saveStatus,
    project: { name: ownershipWorkspaceId === 'workspace' ? 'Protected project' : 'Foreign private title',
      documentType: 'User guide', version: '1.0',
      ownership: { ownerUserId: 'current', workspaceId: ownershipWorkspaceId } },
    onBack: () => {},
    onDiscardProject: () => { (window as unknown as { adminDiscardConfirmed: boolean }).adminDiscardConfirmed = true },
    onProjectSettings: () => { throw new Error('Unauthorized settings navigation') },
  }))
}