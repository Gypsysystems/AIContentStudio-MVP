import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { setCloudAuthSession } from './authSession'
import { setCloudProjectMode } from './authorizedProjectService'
import { isCloudProjectStorageReady } from './cloudProjectRepository'
import type { MembershipRole } from './ownership'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-in'; mode: 'local-dev' }
  | { kind: 'signed-in'; mode: 'supabase'; userId: string; workspaceId: string; role: MembershipRole; organizationName: string; workspaceName: string }
  | { kind: 'cloud-pending'; userId: string; workspaceId: string; role: MembershipRole; organizationName: string; workspaceName: string; message: string }
  | { kind: 'signed-out'; message?: string }
  | { kind: 'unavailable'; message: string }

type CloudAccount = {
  organizationName: string
  workspaceName: string
  busy: boolean
  signOut: () => void
}

const CloudAccountContext = createContext<CloudAccount | null>(null)
const CONNECTION_ERROR = 'Unable to connect. Try again shortly.'
const CREDENTIAL_ERROR = 'Incorrect email or password.'
const INACTIVE_ERROR = 'Your account is inactive. Contact an administrator.'

export function useCloudAccount(): CloudAccount | null {
  return useContext(CloudAccountContext)
}

async function authRequest(action: 'session' | 'login' | 'logout' | 'refresh',
  payload: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Authentication server returned an invalid response.')
  return { status: response.status, body: body as Record<string, unknown> }
}

function sessionState(status: number, body: Record<string, unknown>): AuthState {
  if (status === 503 || body.code === 'LOCAL_DEV_PRIVATE_ONLY')
    return { kind: 'unavailable', message: CONNECTION_ERROR }
  if (status === 403) return { kind: 'signed-out', message: INACTIVE_ERROR }
  if (status === 200 && body.authenticated === true) {
    if (body.mode === 'local-dev') return { kind: 'signed-in', mode: 'local-dev' }
    if (body.mode === 'supabase'
      && typeof body.userId === 'string' && body.userId
      && typeof body.activeWorkspaceId === 'string' && body.activeWorkspaceId
      && typeof body.activeOrganizationName === 'string' && body.activeOrganizationName.trim()
      && typeof body.activeWorkspaceName === 'string' && body.activeWorkspaceName.trim())
      return {
        kind: 'signed-in',
        mode: 'supabase',
        userId: body.userId,
        workspaceId: body.activeWorkspaceId,
        role: ['owner', 'admin', 'editor', 'viewer'].includes(String(body.activeRole))
          ? body.activeRole as MembershipRole : 'viewer',
        organizationName: body.activeOrganizationName,
        workspaceName: body.activeWorkspaceName,
      }
    return { kind: 'unavailable', message: CONNECTION_ERROR }
  }
  if (status === 401 || status === 200) return { kind: 'signed-out' }
  return { kind: 'unavailable', message: CONNECTION_ERROR }
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const cloudAppReady = useRef(false)

  const checkSession = useCallback(async () => {
    try {
      let { status, body } = await authRequest('session')
      if (status === 401) {
        const refreshed = await authRequest('refresh')
        if (refreshed.status === 200) ({ status, body } = await authRequest('session'))
        else if (refreshed.status === 503) ({ status, body } = refreshed)
      }
      const next = sessionState(status, body)
      if (next.kind === 'signed-in' && next.mode === 'supabase') {
        try {
          if (!await isCloudProjectStorageReady()) {
            if (cloudAppReady.current) return
            setState({ ...next, kind: 'cloud-pending', message: 'Cloud project storage is not ready yet.' })
            return
          }
          setCloudAuthSession({
            user: { id: next.userId },
            workspace: { id: next.workspaceId, name: next.workspaceName },
            // This context is only consumed by client defaults; cloud requests never send it.
            membership: { userId: next.userId, workspaceId: next.workspaceId, role: next.role },
          })
          setCloudProjectMode(true)
          cloudAppReady.current = true
        } catch (error) {
          if (cloudAppReady.current) return
          setState({ ...next, kind: 'cloud-pending',
            message: (error as Error).message || 'Cloud project storage is not ready yet.' })
          return
        }
      } else {
        cloudAppReady.current = false
        setCloudProjectMode(false)
        setCloudAuthSession(null)
      }
      setState(next)
    } catch {
      setState({ kind: 'unavailable', message: CONNECTION_ERROR })
    }
  }, [])

  useEffect(() => {
    void checkSession()
    const timer = window.setInterval(() => { void checkSession() }, 60_000)
    return () => window.clearInterval(timer)
  }, [checkSession])

  async function login(event: FormEvent) {
    event.preventDefault()
    setState({ kind: 'signed-out' })
    setBusy(true)
    try {
      const { status, body } = await authRequest('login', { email, password })
      if (status === 200) {
        setPassword('')
        await checkSession()
      } else if (status === 400 || status === 401 || status === 422) {
        setState({ kind: 'signed-out', message: CREDENTIAL_ERROR })
      } else {
        setState(sessionState(status, body))
      }
    } catch {
      setState({ kind: 'unavailable', message: CONNECTION_ERROR })
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      const { status, body } = await authRequest('logout')
      if (status !== 200) setState(sessionState(status, body))
      else {
        cloudAppReady.current = false
        setCloudProjectMode(false)
        setCloudAuthSession(null)
        setState({ kind: 'signed-out' })
      }
    } catch {
      setState({ kind: 'unavailable', message: CONNECTION_ERROR })
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') return <div role="status" className="min-h-screen grid place-items-center text-sm text-gray-600">Checking session…</div>
  if (state.kind === 'signed-in') {
    if (state.mode === 'local-dev') return <>{children}</>
    return <CloudAccountContext.Provider key={state.workspaceId} value={{
      organizationName: state.organizationName,
      workspaceName: state.workspaceName,
      busy,
      signOut: () => { void logout() },
    }}>{children}</CloudAccountContext.Provider>
  }
   if (state.kind === 'cloud-pending') return <main className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-5">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-7 shadow-sm">
         <img src="/brand/header-logo.svg" alt="AI Content Studio" className="h-7 w-auto max-w-full" />
        <h1 className="text-xl font-semibold text-gray-900">{state.organizationName} / {state.workspaceName}</h1>
         <p className="mt-2 text-sm text-gray-600">Signed in to AI Content Studio</p>
        <p role="status" className="mt-3 text-sm text-gray-600">{state.message} Your signed-in session is retained; local projects have not been moved.</p>
        <button type="button" disabled={busy} onClick={() => { setState({ kind: 'loading' }); void checkSession() }}
           className="mt-5 rounded-md bg-[#FF7A1A] px-4 py-2 text-sm text-[#15171A] disabled:opacity-60">Retry readiness</button>
        <button type="button" disabled={busy} onClick={() => void logout()}
          className="ml-3 mt-5 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-60">
          Sign out
        </button>
      </div>
    </main>

   return <main className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-5">
    <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-7 shadow-sm">
       <h1><img src="/brand/header-logo.svg" alt="AI Content Studio" className="h-7 w-auto max-w-full" /></h1>
       <p className="mt-2 text-sm text-gray-600">Sign in to your workspace.</p>
      {state.message && <p role="alert" className="mt-4 text-sm text-red-700">{state.message}</p>}
      {state.kind === 'signed-out' && <form onSubmit={event => { void login(event) }} className="mt-6 space-y-4">
        <label className="block text-sm">Email
          <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 p-2" />
        </label>
        <label className="block text-sm">Password
          <input type="password" autoComplete="current-password" required value={password}
            onChange={event => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 p-2" />
        </label>
         <button type="submit" disabled={busy} className="w-full rounded-md bg-[#FF7A1A] p-2 text-sm font-semibold text-[#15171A] hover:bg-[#E9670D] disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>}
    </div>
  </main>
}