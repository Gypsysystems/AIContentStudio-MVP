import {
  LOCAL_ACCESS_CONTEXT,
  type Membership,
  type ProjectAccessContext,
  type User,
  type Workspace,
} from './ownership'

/**
 * A client session snapshot. This local adapter is for development only and
 * is not an authentication boundary. A future server must resolve the trusted
 * identity and memberships itself instead of accepting client context data.
 */
export interface AuthSession {
  user: User
  workspace: Workspace
  membership: Membership
}

export interface AuthSessionService {
  getSession(): AuthSession
  getAccessContext(): ProjectAccessContext
}

/** Static local-development adapter; it performs no network or provider calls. */
export class LocalDevAuthSessionAdapter implements AuthSessionService {
  private readonly session: AuthSession

  constructor(session: AuthSession = LOCAL_ACCESS_CONTEXT) {
    this.session = {
      user: { ...session.user },
      workspace: { ...session.workspace },
      membership: { ...session.membership },
    }
  }

  getSession(): AuthSession {
    return {
      user: { ...this.session.user },
      workspace: { ...this.session.workspace },
      membership: { ...this.session.membership },
    }
  }

  getAccessContext(): ProjectAccessContext {
    return this.getSession()
  }
}

/** Default local session for the current client-only application. */
export const authSessionService: AuthSessionService = new LocalDevAuthSessionAdapter()

export function getSession(): AuthSession {
  return authSessionService.getSession()
}

export function getAccessContext(): ProjectAccessContext {
  return authSessionService.getAccessContext()
}