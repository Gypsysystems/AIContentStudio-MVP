import { getAccessContext } from './authSession'

export const NAVIGATION_SCREENS = ['dashboard', 'administration', 'project-home', 'history', 'create', 'branding', 'sources', 'analysis', 'structure', 'studio', 'quality', 'preview', 'publish'] as const
export type Screen = typeof NAVIGATION_SCREENS[number]
export type ManagementDestination = 'history' | 'create' | 'branding' | 'administration' | 'diagnostics'
export type ManagementScope = {
  destination: ManagementDestination
  origin: 'home' | 'project'
  returnScreen: Screen
  originProjectId: string | null
  selectedProjectId: string
  parent?: ManagementScope
}
export type NavigationLocation = {
  screen: Screen
  projectId: string | null
  prevScreen: Screen | null
  management: ManagementScope | null
  diagnosticsOpen: boolean
}

// Tab-local UI location, not project state or an authorization claim.
function scopeKey(): string {
  const { user, workspace } = getAccessContext()
  return JSON.stringify([user.id, workspace.id])
}

function isScreen(value: unknown): value is Screen {
  return NAVIGATION_SCREENS.includes(value as Screen)
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}
function parseManagement(value: unknown, depth = 0): ManagementScope | null {
  if (!value || typeof value !== 'object' || depth > 4) return null
  const m = value as Record<string, unknown>
  if (typeof m.destination !== 'string' || !['history', 'create', 'branding', 'administration', 'diagnostics'].includes(m.destination)
    || (m.origin !== 'home' && m.origin !== 'project') || !isScreen(m.returnScreen)
    || !(m.originProjectId === null || isId(m.originProjectId))
    || !(m.selectedProjectId === '' || isId(m.selectedProjectId))) return null
  const parent = m.parent === undefined ? undefined : parseManagement(m.parent, depth + 1)
  if (parent === null) return null
  return {
    destination: m.destination as ManagementDestination, origin: m.origin as 'home' | 'project',
    returnScreen: m.returnScreen, originProjectId: m.originProjectId as string | null,
    selectedProjectId: m.selectedProjectId as string, ...(parent ? { parent } : {}),
  }
}

export function parseNavigationLocation(value: unknown): NavigationLocation | null {
  if (!value || typeof value !== 'object') return null
  const n = value as Record<string, unknown>
  if (n.version !== 1 || !isScreen(n.screen)
    || !(n.projectId === null || isId(n.projectId))
    || !(n.prevScreen === null || isScreen(n.prevScreen))
    || typeof n.diagnosticsOpen !== 'boolean') return null
  const management = n.management === null ? null : parseManagement(n.management)
  if (n.management !== null && !management) return null
  if (n.diagnosticsOpen !== (management?.destination === 'diagnostics')) return null
  if (management && management.destination !== 'diagnostics' && n.screen !== management.destination) return null
  return { screen: n.screen, projectId: n.projectId as string | null, prevScreen: n.prevScreen, management, diagnosticsOpen: n.diagnosticsOpen }
}

export function readNavigationLocation(): NavigationLocation | null {
  try {
    const raw = window.sessionStorage.getItem(`docflow-navigation-location:${scopeKey()}`)
    if (raw !== null) return raw.length <= 16_384 ? parseNavigationLocation(JSON.parse(raw)) : null
    // Preserve the previous dashboard-only hint during this transition.
    if (window.sessionStorage.getItem(`docflow-dashboard-entry:${scopeKey()}`) === 'dashboard')
      return { screen: 'dashboard', projectId: null, prevScreen: null, management: null, diagnosticsOpen: false }
    return null
  } catch {
    return null
  }
}

export function recordNavigationLocation(location: NavigationLocation): void {
  try {
    window.sessionStorage.setItem(`docflow-navigation-location:${scopeKey()}`, JSON.stringify({ version: 1, ...location }))
    window.sessionStorage.removeItem(`docflow-dashboard-entry:${scopeKey()}`)
  } catch {
    // Restricted browser storage must not interrupt project saves or navigation.
  }
}

export function resolveNavigationLocation(
  saved: NavigationLocation | null,
  projectId: string | null,
  canEditSettings: boolean,
  accessibleProjects: ReadonlySet<string> = new Set(),
): NavigationLocation {
  const fallback: NavigationLocation = {
    screen: projectId ? 'project-home' : 'dashboard', projectId,
    prevScreen: null, management: null, diagnosticsOpen: false,
  }
  if (!saved) return fallback
  if (!saved.management && saved.screen === 'dashboard') return { ...fallback, screen: 'dashboard' }
  if (saved.projectId !== projectId) return fallback
  if (!saved.management) {
    if (!projectId && saved.screen !== 'administration') return fallback
    if (saved.screen === 'create' && !canEditSettings) return fallback
    return saved
  }
  const m = saved.management
  for (let scope: ManagementScope | undefined = m; scope; scope = scope.parent) {
    if (scope.origin === 'project' && !scope.originProjectId) return fallback
    if (scope.originProjectId && !accessibleProjects.has(scope.originProjectId)) return fallback
    if (scope.selectedProjectId && scope.selectedProjectId !== 'all' && !accessibleProjects.has(scope.selectedProjectId)) return fallback
    if (scope.selectedProjectId === 'all' && !['history', 'diagnostics'].includes(scope.destination)) return fallback
  }
  if (m.selectedProjectId && m.selectedProjectId !== 'all' && m.selectedProjectId !== projectId) return fallback
  if (m.destination === 'create' && m.selectedProjectId && !canEditSettings) return fallback
  return saved
}