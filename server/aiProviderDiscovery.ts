export type ProviderDiscoveryResult =
  | { state: 'available'; models: { providerId: string; id: string; label: string }[] }
  | { state: 'auth-failed' | 'unsupported' | 'unavailable'; models: [] }

type ProviderConfig = {
  url: string
  headers: (credential: string) => Record<string, string>
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (credential) => ({ Authorization: `Bearer ${credential}` }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    headers: (credential) => ({
      'x-api-key': credential,
      'anthropic-version': '2023-06-01',
    }),
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    headers: (credential) => ({ 'x-goog-api-key': credential }),
  },
}

const MAX_RESPONSE_BYTES = 2_000_000
const MAX_MODELS = 1_000
const MAX_ID_LENGTH = 200
const MAX_LABEL_LENGTH = 200
const REQUEST_TIMEOUT_MS = 10_000

function unavailable(): ProviderDiscoveryResult {
  return { state: 'unavailable', models: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number, allowSpaces: boolean): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) return null
  if (!allowSpaces && /\s/u.test(value)) return null
  return value
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('invalid response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('response too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return JSON.parse(text) as unknown
}

function modelsFrom(providerId: string, payload: unknown): { providerId: string; id: string; label: string }[] | null {
  const recordsField = providerId === 'google' ? 'models' : 'data'
  if (!isRecord(payload) || !Array.isArray(payload[recordsField])) return null
  const records = payload[recordsField] as unknown[]
  if (records.length > MAX_MODELS) return null

  const models: { providerId: string; id: string; label: string }[] = []
  for (const item of records) {
    if (!isRecord(item)) return null
    let rawId: unknown
    let rawLabel: unknown
    if (providerId === 'openai') {
      rawId = item.id
      rawLabel = item.id
    } else if (providerId === 'anthropic') {
      rawId = item.id
      rawLabel = item.display_name === undefined ? item.id : item.display_name
    } else {
      if (!Array.isArray(item.supportedGenerationMethods)
        || !item.supportedGenerationMethods.every((method) => typeof method === 'string')) return null
      if (typeof item.name !== 'string' || !item.name.startsWith('models/')) return null
      rawId = item.name.slice('models/'.length)
      rawLabel = item.displayName === undefined ? rawId : item.displayName
    }
    const id = boundedString(rawId, MAX_ID_LENGTH, false)
    const label = boundedString(rawLabel, MAX_LABEL_LENGTH, true)
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id) || !label) return null
    if (providerId === 'google' && !(item.supportedGenerationMethods as string[]).includes('generateContent')) continue
    models.push({ providerId, id, label })
  }

  const deduplicated = new Map<string, { providerId: string; id: string; label: string }>()
  for (const model of models) {
    const existing = deduplicated.get(model.id)
    if (!existing || compareStrings(model.label, existing.label) < 0) deduplicated.set(model.id, model)
  }
  return [...deduplicated.values()].sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.label, b.label))
}

export async function discoverProviderModels(
  providerId: string,
  credential: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderDiscoveryResult> {
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, providerId))
    return { state: 'unsupported', models: [] }
  const provider = PROVIDERS[providerId]
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > 8192) return unavailable()

  try {
    const response = await fetchImpl(provider.url, {
      method: 'GET',
      headers: provider.headers(credential),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403)
      return { state: 'auth-failed', models: [] }
    if (!response.ok || response.status >= 300) return unavailable()
    const models = modelsFrom(providerId, await readJson(response))
    // A provider response is untrusted; never reflect an echoed credential as model metadata.
    return models && !models.some(model => model.id.includes(credential) || model.label.includes(credential))
      ? { state: 'available', models } : unavailable()
  } catch {
    return unavailable()
  }
}