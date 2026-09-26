import { getAccessContext } from './authSession'
import { isCloudProjectMode } from './authorizedProjectService'
import type { ConnectionCommand, ConnectionMetadata } from './aiConnectionModel'

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/

export class ConnectionApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
function context(manage = false): string {
  const value = getAccessContext()
  if (!isCloudProjectMode() || !value || !value.user || !value.membership || !value.workspace
    || value.user.id !== value.membership.userId || value.workspace.id !== value.membership.workspaceId)
    throw new ConnectionApiError(503, 'CONNECTIONS_UNAVAILABLE', 'Cloud connections require an active workspace.')
  if (manage && !['owner', 'admin'].includes(value.membership.role))
    throw new ConnectionApiError(403, 'FORBIDDEN', 'Only workspace owners and administrators can manage connections.')
  return value.workspace.id
}
function record(input: unknown, workspaceId: string): ConnectionMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Invalid connection record.')
  const item = input as Record<string, unknown>
  if (Object.keys(item).sort().join(',') !== 'providerId,revision,state,testedAt,updatedAt,updatedBy,workspaceId'
    || item.workspaceId !== workspaceId || typeof item.providerId !== 'string' || !ID.test(item.providerId)
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || !['untested', 'verified', 'failed', 'unavailable'].includes(String(item.state))
    || item.testedAt !== null && (typeof item.testedAt !== 'string' || Number.isNaN(Date.parse(item.testedAt)))
    || typeof item.updatedAt !== 'string' || Number.isNaN(Date.parse(item.updatedAt))
    || typeof item.updatedBy !== 'string' || !item.updatedBy)
    throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Connection data could not be verified.')
  return item as ConnectionMetadata
}
async function command(input: ConnectionCommand): Promise<unknown> {
  const workspaceId = context(input.action !== 'list')
  let response: Response
  try {
    response = await fetch('/api/ai-connections', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, workspaceId }),
    })
  } catch { throw new ConnectionApiError(503, 'CONNECTIONS_UNAVAILABLE', 'Connection server is unavailable.') }
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Connection server returned an invalid response.')
  const data = body as Record<string, unknown>
  if (!response.ok) {
    const known = ['UNAUTHENTICATED', 'FORBIDDEN', 'REVISION_CONFLICT', 'SCHEMA_UNAVAILABLE',
      'ENCRYPTION_UNAVAILABLE', 'READER_UNAVAILABLE', 'CONNECTIONS_UNAVAILABLE', 'NOT_FOUND',
      'STORAGE_RESPONSE_INVALID', 'CREDENTIAL_INVALID', 'INVALID_REQUEST']
    const code = typeof data.code === 'string' && known.includes(data.code) ? data.code : 'CONNECTIONS_UNAVAILABLE'
    const messages: Record<string, string> = {
      UNAUTHENTICATED: 'Sign in again to manage this workspace.',
      FORBIDDEN: 'Your current workspace role does not allow this action.',
      REVISION_CONFLICT: 'This connection changed. Refresh before trying again.',
      SCHEMA_UNAVAILABLE: 'Connection storage has not been installed.',
      ENCRYPTION_UNAVAILABLE: 'Secure connection encryption is not configured.',
      READER_UNAVAILABLE: 'Secure credential testing is not configured.',
      CONNECTIONS_UNAVAILABLE: 'Connection service is unavailable. No local fallback was used.',
      NOT_FOUND: 'Connection no longer exists. Refresh to see the current state.',
      STORAGE_RESPONSE_INVALID: 'The server could not confirm this connection change.',
      CREDENTIAL_INVALID: 'Stored credential could not be verified.',
      INVALID_REQUEST: 'Review the connection fields and try again.',
    }
    throw new ConnectionApiError(response.status, code, messages[code])
  }
  if (input.action === 'list') {
    if (Object.keys(data).join(',') !== 'connections' || !Array.isArray(data.connections))
      throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Invalid connection list.')
    const values = data.connections.map(value => record(value, workspaceId))
    if (new Set(values.map(c => c.providerId)).size !== values.length)
      throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Duplicate connections were returned.')
    return values
  }
  if (input.action === 'delete') {
    if (Object.keys(data).sort().join(',') !== 'deleted,providerId,revision'
      || data.deleted !== true || data.providerId !== input.providerId || data.revision !== input.expectedRevision)
      throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Connection deletion was not confirmed.')
    return true
  }
  if (Object.keys(data).join(',') !== 'connection')
    throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Connection change was not confirmed.')
  const confirmed = record(data.connection, workspaceId)
  if (confirmed.providerId !== input.providerId
    || confirmed.revision !== (input.action === 'create' ? 1 : input.action === 'replace' ? input.expectedRevision + 1 : input.expectedRevision)
    || (input.action === 'create' || input.action === 'replace') && confirmed.state !== 'untested')
    throw new ConnectionApiError(503, 'INVALID_RESPONSE', 'Connection change was not confirmed.')
  return confirmed
}
export const listConnections = () => command({ action: 'list' }) as Promise<ConnectionMetadata[]>
export const createConnection = (providerId: string, credential: string) =>
  command({ action: 'create', providerId, credential }) as Promise<ConnectionMetadata>
export const replaceConnection = (providerId: string, expectedRevision: number, credential: string) =>
  command({ action: 'replace', providerId, expectedRevision, credential }) as Promise<ConnectionMetadata>
export const testConnection = (providerId: string, expectedRevision: number) =>
  command({ action: 'test', providerId, expectedRevision }) as Promise<ConnectionMetadata>
export const deleteConnection = (providerId: string, expectedRevision: number) =>
  command({ action: 'delete', providerId, expectedRevision }) as Promise<true>