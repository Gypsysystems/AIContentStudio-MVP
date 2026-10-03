import { getAccessContext } from './authSession'

// Navigation intent is tab-local and separate from the retained active project.
// Verified identity scopes prevent another account/workspace inheriting it.
function dashboardHintKey(): string {
  const { user, workspace } = getAccessContext()
  return `docflow-dashboard-entry:${JSON.stringify([user.id, workspace.id])}`
}

export function readDashboardHint(): boolean {
  try {
    return window.sessionStorage.getItem(dashboardHintKey()) === 'dashboard'
  } catch {
    // Browser storage restrictions must not prevent authorized project loading.
    return false
  }
}

export function recordDashboardHint(onDashboard: boolean): void {
  try {
    const key = dashboardHintKey()
    if (onDashboard) window.sessionStorage.setItem(key, 'dashboard')
    else window.sessionStorage.removeItem(key)
  } catch {
    // This optional UI hint never changes project data or authentication.
  }
}