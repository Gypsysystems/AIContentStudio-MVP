import { useEffect, useRef, useState, type FormEvent } from 'react'

type Profile = { displayName: string | null; updatedAt: string }
type ProfileState = 'loading' | 'ready' | 'saving' | 'saved' | 'error'
class ProfileConflictError extends Error {}

async function profileRequest(action: 'read' | 'update', displayName?: string, expectedUpdatedAt?: string): Promise<Profile> {
  const response = await fetch('/api/auth/profile', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'read' ? { action } : { action, displayName, expectedUpdatedAt }),
  })
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Profile server returned an invalid response.')
  const result = body as Record<string, unknown>
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : 'Profile settings could not be saved.'
    if (response.status === 409 && result.code === 'PROFILE_CONFLICT') throw new ProfileConflictError(message)
    throw new Error(message)
  }
  if ((result.displayName !== null && typeof result.displayName !== 'string')
    || typeof result.updatedAt !== 'string' || !result.updatedAt)
    throw new Error('Profile server did not confirm the saved settings.')
  return { displayName: result.displayName, updatedAt: result.updatedAt }
}

export default function MySettings({ mode, userId }: { mode: 'local-dev' | 'cloud'; userId: string }) {
  const identityRef = useRef(`${mode}:${userId}`)
  identityRef.current = `${mode}:${userId}`
  const [profile, setProfile] = useState<Profile | null>(null)
  const [state, setState] = useState<ProfileState>('loading')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reload, setReload] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)

  useEffect(() => {
    if (mode !== 'cloud') return
    let current = true
    setProfile(null)
    setEditing(false)
    setConflict(false)
    setConfirmReload(false)
    setState('loading')
    setError('')
    void profileRequest('read').then(result => {
      if (!current) return
      setProfile(result)
      setState('ready')
    }).catch(reason => {
      if (!current) return
      setState('error')
      setError(reason instanceof Error ? reason.message : 'Profile settings could not be loaded.')
    })
    return () => { current = false }
  }, [mode, userId, reload])

  function cancel() {
    setDraft(profile?.displayName ?? '')
    setEditing(false)
    setConflict(false)
    setConfirmReload(false)
    setError('')
    setState('ready')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!profile || state === 'saving') return
    const identity = identityRef.current
    const name = draft.trim()
    if (!name || name.length > 100) {
      setError('Display name must contain 1 to 100 characters.')
      setState('error')
      return
    }
    setError('')
    setState('saving')
    try {
      const saved = await profileRequest('update', name, profile.updatedAt)
      if (identityRef.current !== identity) return
      if (saved.displayName !== name) throw new Error('Profile server did not confirm the saved name.')
      setProfile(saved)
      setDraft(saved.displayName)
      setEditing(false)
      setState('saved')
    } catch (reason) {
      if (identityRef.current !== identity) return
      setState('error')
      setConflict(reason instanceof ProfileConflictError)
      setError(reason instanceof Error ? reason.message : 'Profile settings could not be saved.')
    }
  }

  return (
    <section aria-labelledby="my-settings-heading" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-6" data-testid="my-settings">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74738A]">Your profile</p>
      <h2 id="my-settings-heading" className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[#20202C]">My Settings</h2>
      <p className="mt-1 text-[12px] leading-5 text-[#777685]">Your display name is personal to your signed-in account. It does not change your workspace role.</p>
      {mode === 'local-dev' ? (
        <div className="mt-4 rounded-xl border border-[#E8E6E0] bg-[#F5F4F1] px-4 py-3 text-[11px] leading-5 text-[#777685]">
          <p className="font-semibold text-[#4A4955]">Display name is read-only in local development</p>
          <p>There is no persisted cloud profile for this local identity. No profile changes can be saved here.</p>
        </div>
      ) : (
        <div className="mt-4">
          {state === 'loading' && <p role="status" className="text-[11px] text-[#777685]">Loading your display name…</p>}
          {profile && !editing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-4">
              <div>
                <p className="text-[10px] font-medium text-[#777685]">Display name</p>
                <p className="mt-1 text-[13px] font-semibold text-[#292936]">{profile.displayName || 'Not set'}</p>
              </div>
              <button type="button" onClick={() => { setDraft(profile.displayName ?? ''); setEditing(true); setState('ready'); setError('') }}
                className="min-h-9 rounded-lg border border-[#DCDAD4] bg-white px-3 text-[11px] font-semibold text-[#555461] hover:border-[#C7C5F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">
                Edit display name
              </button>
            </div>
          )}
          {profile && editing && (
            <form onSubmit={event => { void save(event) }} className="rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-4">
              <label htmlFor="my-display-name" className="block text-[11px] font-semibold text-[#393844]">Display name</label>
              <input id="my-display-name" autoFocus value={draft} maxLength={100} disabled={state === 'saving'}
                aria-invalid={Boolean(error)} aria-describedby="display-name-help"
                onChange={event => { setDraft(event.target.value); if (error) setError('') }}
                onKeyDown={event => { if (event.key === 'Escape' && state !== 'saving') cancel() }}
                className="mt-2 min-h-10 w-full rounded-lg border border-[#DCDAD4] bg-white px-3 text-[13px] text-[#292936] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:opacity-60" />
              <p id="display-name-help" className="mt-1 text-[10px] text-[#777685]">
                {draft.trim() ? '1 to 100 characters. Press Enter to save or Escape to cancel.' : 'Enter a display name before saving.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={state === 'saving' || !draft.trim()}
                  className="min-h-9 rounded-lg bg-[#5B5BD6] px-3 text-[11px] font-semibold text-white hover:bg-[#4A4AC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:cursor-not-allowed disabled:opacity-50">
                  {state === 'saving' ? 'Saving…' : 'Save display name'}
                </button>
                <button type="button" onClick={cancel} disabled={state === 'saving'}
                  className="min-h-9 rounded-lg border border-[#DCDAD4] bg-white px-3 text-[11px] font-semibold text-[#555461] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {state === 'saving' && <p role="status" className="mt-2 text-[11px] text-[#777685]">Saving your display name…</p>}
          {state === 'saved' && <p role="status" className="mt-2 text-[11px] text-[#3E765B]">Display name saved.</p>}
          {error && <div role="alert" className="mt-2 text-[11px] text-[#B42323]">
            {error}
            {!profile && <button type="button" onClick={() => setReload(value => value + 1)}
              className="ml-2 min-h-9 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">Retry loading</button>}
            {conflict && <button type="button" onClick={() => setConfirmReload(true)}
              className="ml-2 min-h-9 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">Reload latest profile</button>}
          </div>}
          {confirmReload && <div role="alertdialog" aria-labelledby="reload-profile-title" aria-describedby="reload-profile-description"
            className="mt-3 rounded-lg border border-[#E5C6A2] bg-[#FFF8ED] p-3 text-[11px]">
            <p id="reload-profile-title" className="font-semibold">Reload the latest display name?</p>
            <p id="reload-profile-description" className="mt-1">Your unsaved display-name edit will be discarded.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setReload(value => value + 1)}
                className="min-h-9 rounded-md bg-[#5B5BD6] px-3 font-semibold text-white">Discard draft and reload</button>
              <button type="button" onClick={() => setConfirmReload(false)}
                className="min-h-9 rounded-md border border-[#D8D5CF] px-3 font-semibold">Keep editing</button>
            </div>
          </div>}
        </div>
      )}
    </section>
  )
}