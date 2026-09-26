import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ProjectAccessContext } from '../ownership'
import type { ConnectionMetadata } from '../aiConnectionModel'
import { ConnectionApiError, createConnection, deleteConnection, listConnections, replaceConnection, testConnection } from '../aiConnectionRepository'
import { isCloudProjectMode } from '../authorizedProjectService'

type Props = { mode: 'local-dev' | 'cloud'; context: ProjectAccessContext }
const stateNames = {
  untested: 'Configured · untested',
  verified: 'Verified',
  failed: 'Failed test',
  unavailable: 'Test unavailable',
}
function message(error: unknown): string {
  return error instanceof ConnectionApiError ? error.message : 'The connection request failed. Refresh to confirm the current saved state.'
}
const button = 'rounded-lg border border-[#D9D7E5] bg-white px-3 py-2 text-[11px] font-semibold text-[#504F72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:opacity-50'

export default function Connections({ mode, context }: Props) {
  const cloudEnabled = mode === 'cloud' || isCloudProjectMode()
  const canManage = context.membership.role === 'owner' || context.membership.role === 'admin'
  const [connections, setConnections] = useState<ConnectionMetadata[]>([])
  const [loading, setLoading] = useState(cloudEnabled)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [providerId, setProviderId] = useState('')
  const [credential, setCredential] = useState('')
  const [replacing, setReplacing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const sequence = useRef(0)
  const visibleConnections = connections.filter(item => item.workspaceId === context.workspace.id)
  const refresh = useCallback(async () => {
    if (!cloudEnabled) return
    const request = ++sequence.current
    setLoading(true)
    setLoadError('')
    try {
      const values = await listConnections()
      if (values.some(value => value.workspaceId !== context.workspace.id))
        throw new Error('Another workspace was returned.')
      if (request === sequence.current) setConnections(values)
    } catch (cause) {
      if (request === sequence.current) {
        setConnections([])
        setLoadError(message(cause))
      }
    } finally { if (request === sequence.current) setLoading(false) }
  }, [cloudEnabled, context.workspace.id])
  useEffect(() => { void refresh(); return () => { sequence.current += 1 } }, [refresh])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canManage || busy || loading || loadError || !credential.trim()) return
    const selected = replacing ? visibleConnections.find(item => item.providerId === replacing) : null
    if (replacing && !selected) { setError('Connection changed. Refresh before trying again.'); return }
    const secret = credential
    setCredential('')
    setBusy(true); setNotice(''); setError('')
    try {
      const result = selected
        ? await replaceConnection(selected.providerId, selected.revision, secret)
        : await createConnection(providerId.trim(), secret)
      setConnections(items => [...items.filter(item => item.providerId !== result.providerId), result].sort((a, b) => a.providerId.localeCompare(b.providerId)))
      setNotice(`${result.providerId} saved. The credential has not been tested.`)
      setProviderId(''); setReplacing(null)
    } catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }
  async function act(item: ConnectionMetadata, action: 'test' | 'delete') {
    if (!canManage || busy || loading || loadError) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'test') {
        const result = await testConnection(item.providerId, item.revision)
        setConnections(items => items.map(value => value.providerId === item.providerId ? result : value))
        setNotice(result.state === 'verified' ? `${item.providerId} verified.`
          : result.state === 'failed' ? `${item.providerId} failed its credential test.`
            : `${item.providerId} could not be tested: no provider test adapter is configured.`)
      } else {
        await deleteConnection(item.providerId, item.revision)
        setConnections(items => items.filter(value => value.providerId !== item.providerId))
        setDeleting(null); setReplacing(null); setCredential('')
        setNotice(`${item.providerId} was removed from this workspace. Revoke the key separately at the provider if needed.`)
      }
    } catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="connections-title" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-7">
    <div className="border-b border-[#ECEAE5] pb-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74738A]">Provider access</p>
      <h3 id="connections-title" className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-[#292834]">Connections</h3>
      <p className="mt-1 text-[11px] leading-5 text-[#777685]">Workspace connection status only. Credentials are never displayed after submission.</p>
    </div>
    {!cloudEnabled ? <div className="mt-5 rounded-xl border border-[#E9DECD] bg-[#F7F1E8] p-4 text-[11px] text-[#6D5738]">
      <strong>Unconfigured</strong><p className="mt-2">No connection record. Local development does not provide a persisted provider connection.</p>
      <p className="mt-2">No provider operations are available here. Model selection: Auto only.</p>
    </div> : <>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className={button} onClick={() => { void refresh() }} disabled={loading || busy}>Refresh connections</button>
        {loading && <span role="status" className="text-[11px] text-[#747381]">Loading connections…</span>}
        {busy && <span role="status" className="text-[11px] text-[#747381]">Saving connection change…</span>}
      </div>
      {loadError ? <p role="alert" className="mt-4 rounded-lg bg-[#FFF3F0] p-3 text-[11px] text-[#874E42]">Connections could not be loaded: {loadError}. Retry loading before making changes.</p> : <>
        {notice && <p role="status" className="mt-4 rounded-lg bg-[#EFF5F0] p-3 text-[11px] text-[#44674E]">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-[#FFF3F0] p-3 text-[11px] text-[#874E42]">{error} Refresh to confirm the saved state.</p>}
        {!loading && visibleConnections.length === 0 && <p className="mt-5 rounded-lg border border-dashed border-[#DCDAD4] p-4 text-[11px] text-[#777685]">Unconfigured · No connection record in this workspace.</p>}
        <ul className="mt-5 space-y-3">{visibleConnections.map(item => <li key={item.providerId} className="rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div>
            <p className="text-[12px] font-semibold text-[#393844]">{item.providerId}</p>
            <p className="mt-1 text-[10px] text-[#747381]">{stateNames[item.state]} · revision {item.revision}{item.testedAt ? ` · tested ${new Date(item.testedAt).toLocaleString()}` : ''}</p>
          </div>{canManage && <div className="flex flex-wrap gap-2">
            <button className={button} type="button" disabled={busy || loading} onClick={() => { setReplacing(item.providerId); setCredential(''); setDeleting(null) }}>Replace credential</button>
            <button className={button} type="button" disabled={busy || loading} onClick={() => { void act(item, 'test') }}>Test connection</button>
            <button className={button} type="button" disabled={busy || loading} onClick={() => setDeleting(item.providerId)}>Delete</button>
          </div>}</div>
          {canManage && deleting === item.providerId && <div className="mt-3 flex items-center gap-3 text-[11px]">
            <span>Remove the stored credential? Provider-side revocation is separate.</span>
            <button type="button" className={button} disabled={busy} onClick={() => { void act(item, 'delete') }}>Confirm delete</button>
            <button type="button" className={button} onClick={() => setDeleting(null)}>Cancel</button>
          </div>}
        </li>)}</ul>
        {canManage && !loading && <form onSubmit={event => { void save(event) }} className="mt-5 space-y-3 rounded-xl border border-[#E6E4DE] p-4">
          <h4 className="text-[12px] font-semibold text-[#393844]">{replacing ? `Replace ${replacing} credential` : 'Create connection'}</h4>
          {!replacing && <label className="block text-[11px] text-[#555460]">Provider ID
            <input className="mt-1 block w-full rounded-lg border border-[#DCDAD4] bg-white p-2 text-[12px]" required maxLength={90} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={providerId} onChange={event => setProviderId(event.target.value)} />
          </label>}
          <label className="block text-[11px] text-[#555460]">Credential
            <input className="mt-1 block w-full rounded-lg border border-[#DCDAD4] bg-white p-2 text-[12px]" type="password" required autoComplete="new-password" maxLength={4096} value={credential} onChange={event => setCredential(event.target.value)} />
          </label>
          <div className="flex gap-2"><button type="submit" className={button} disabled={busy || !credential.trim()}>{replacing ? 'Save replacement' : 'Save connection'}</button>
            {replacing && <button type="button" className={button} onClick={() => { setReplacing(null); setCredential('') }}>Cancel</button>}</div>
          <p className="text-[10px] text-[#898793]">Saving does not verify a provider. An unsupported test reports unavailable, never connected.</p>
        </form>}
        {!canManage && <p className="mt-5 text-[11px] text-[#747381]">Read-only access. Owners and administrators manage credentials.</p>}
      </>}
    </>}
  </section>
}