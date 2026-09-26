/** Browser-safe, workspace-scoped connection data. Credentials are never part of this contract. */
export type ConnectionState = 'untested' | 'verified' | 'failed' | 'unavailable'
export type ConnectionMetadata = {
  workspaceId: string
  providerId: string
  revision: number
  state: ConnectionState
  testedAt: string | null
  updatedAt: string
  updatedBy: string
}
export type ModelDiscovery =
  | { state: 'available'; models: { providerId: string; id: string; label: string }[]; discoveredAt: string }
  | { state: 'unsupported' | 'unavailable'; models: []; discoveredAt: null }

export type ConnectionCommand =
  | { action: 'list' }
  | { action: 'create'; providerId: string; credential: string }
  | { action: 'replace'; providerId: string; expectedRevision: number; credential: string }
  | { action: 'test'; providerId: string; expectedRevision: number }
  | { action: 'delete'; providerId: string; expectedRevision: number }