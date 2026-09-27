export type GroundedTocProviderErrorCode =
  | 'UNSUPPORTED_PROVIDER'
  | 'INVALID_REQUEST'
  | 'TOO_LARGE'
  | 'AUTH_FAILED'
  | 'REFUSED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PROVIDER_FAILURE'
  | 'PROVIDER_ERROR'

export class GroundedTocProviderError extends Error {
  readonly code: GroundedTocProviderErrorCode

  constructor(code: GroundedTocProviderErrorCode, message: string) {
    super(message)
    this.name = 'GroundedTocProviderError'
    this.code = code
  }
}

export type GroundedTocGenerationRequest = {
  providerId: string
  modelId: string
  credential: string
  systemInstructions: string
  userContent: string
}

export type GroundedTocProviderOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 256_000
const MAX_REQUEST_BYTES = 150_000
const MAX_CREDENTIAL_LENGTH = 8_192
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u

function providerError(code: GroundedTocProviderErrorCode): GroundedTocProviderError {
  const messages: Record<GroundedTocProviderErrorCode, string> = {
    UNSUPPORTED_PROVIDER: 'The configured provider is not supported for Generate TOC.',
    INVALID_REQUEST: 'The provider request is invalid.',
    TOO_LARGE: 'The provider request or response exceeds the supported size limit.',
    AUTH_FAILED: 'The provider rejected the configured connection.',
    REFUSED: 'The provider refused to generate a proposed TOC.',
    RATE_LIMITED: 'The provider rate limit was reached.',
    NETWORK_ERROR: 'The provider could not be reached.',
    TIMEOUT: 'The provider request timed out.',
    PROVIDER_FAILURE: 'The provider did not complete TOC generation.',
    PROVIDER_ERROR: 'The provider could not generate a proposed TOC.',
  }
  return new GroundedTocProviderError(code, messages[code])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRequest(input: GroundedTocGenerationRequest): void {
  if (!['openai', 'anthropic', 'google'].includes(input.providerId))
    throw providerError('UNSUPPORTED_PROVIDER')
  if (!MODEL_ID.test(input.modelId)
    || typeof input.credential !== 'string' || !input.credential
    || input.credential.length > MAX_CREDENTIAL_LENGTH || /[\r\n]/u.test(input.credential)
    || typeof input.systemInstructions !== 'string' || !input.systemInstructions
    || typeof input.userContent !== 'string' || !input.userContent) {
    throw providerError('INVALID_REQUEST')
  }
  const size = Buffer.byteLength(JSON.stringify({
    modelId: input.modelId,
    systemInstructions: input.systemInstructions,
    userContent: input.userContent,
  }), 'utf8')
  if (size > MAX_REQUEST_BYTES) throw providerError('TOO_LARGE')
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number(declaredLength) > maxBytes) throw providerError('TOO_LARGE')
  if (!response.body) throw providerError('PROVIDER_ERROR')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel()
        throw providerError('TOO_LARGE')
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
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw providerError('PROVIDER_ERROR')
  }
}

function responseText(providerId: string, payload: unknown): string {
  if (!isRecord(payload)) throw providerError('PROVIDER_ERROR')
  if (providerId === 'openai') {
    if (payload.status !== 'completed') throw providerError('PROVIDER_FAILURE')
    if (!Array.isArray(payload.output)) throw providerError('PROVIDER_ERROR')
    const blocks = payload.output.flatMap(output => {
      if (!isRecord(output) || !Array.isArray(output.content)) return []
      return output.content
    })
    if (blocks.some(block => isRecord(block) && block.type === 'refusal')) throw providerError('REFUSED')
    const textBlocks = blocks.filter(block => isRecord(block) && block.type === 'output_text')
    if (textBlocks.length !== 1 || !isRecord(textBlocks[0]) || typeof textBlocks[0].text !== 'string')
      throw providerError('PROVIDER_ERROR')
    return textBlocks[0].text
  }
  if (providerId === 'anthropic') {
    if (payload.stop_reason === 'refusal' || payload.stop_reason === 'content_filter')
      throw providerError('REFUSED')
    if (payload.stop_reason !== 'end_turn') throw providerError('PROVIDER_FAILURE')
    if (!Array.isArray(payload.content)) throw providerError('PROVIDER_ERROR')
    if (payload.content.some(block => isRecord(block) && block.type === 'refusal')) throw providerError('REFUSED')
    const blocks = payload.content.filter(block => isRecord(block) && block.type === 'text')
    if (blocks.length !== 1 || !isRecord(blocks[0]) || typeof blocks[0].text !== 'string')
      throw providerError('PROVIDER_ERROR')
    return blocks[0].text
  }
  if (isRecord(payload.promptFeedback) && payload.promptFeedback.blockReason)
    throw providerError('REFUSED')
  if (!Array.isArray(payload.candidates) || !isRecord(payload.candidates[0]))
    throw providerError('PROVIDER_ERROR')
  const candidate = payload.candidates[0]
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(String(candidate.finishReason)))
    throw providerError('REFUSED')
  if (candidate.finishReason !== 'STOP') throw providerError('PROVIDER_FAILURE')
  if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts))
    throw providerError('PROVIDER_ERROR')
  const textParts = candidate.content.parts.filter(part => isRecord(part) && typeof part.text === 'string')
  if (textParts.length !== 1 || !isRecord(textParts[0]) || typeof textParts[0].text !== 'string')
    throw providerError('PROVIDER_ERROR')
  return textParts[0].text
}

function requestFor(input: GroundedTocGenerationRequest): {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
} {
  const headers = { 'Content-Type': 'application/json' }
  if (input.providerId === 'openai') {
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: { ...headers, Authorization: `Bearer ${input.credential}` },
      body: {
        model: input.modelId,
        input: [
          { role: 'system', content: input.systemInstructions },
          { role: 'user', content: input.userContent },
        ],
        store: false,
        text: { format: { type: 'json_object' } },
      },
    }
  }
  if (input.providerId === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        ...headers,
        'x-api-key': input.credential,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: input.modelId,
        max_tokens: 4_000,
        system: input.systemInstructions,
        messages: [{ role: 'user', content: input.userContent }],
      },
    }
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
    headers: { ...headers, 'x-goog-api-key': input.credential },
    body: {
      systemInstruction: { parts: [{ text: input.systemInstructions }] },
      contents: [{ role: 'user', parts: [{ text: input.userContent }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
  }
}

export async function generateGroundedTocText(
  input: GroundedTocGenerationRequest,
  options: GroundedTocProviderOptions = {},
): Promise<string> {
  assertRequest(input)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 2_000_000) {
    throw providerError('INVALID_REQUEST')
  }
  const request = requestFor(input)
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw providerError(error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR')
  }
  if (response.status === 401 || response.status === 403) throw providerError('AUTH_FAILED')
  if (response.status === 429) throw providerError('RATE_LIMITED')
  if (!response.ok || response.status >= 300) throw providerError('PROVIDER_ERROR')
  try {
    const payload = await readBoundedBody(response, maxResponseBytes)
    return responseText(input.providerId, payload)
  } catch (error) {
    if (error instanceof GroundedTocProviderError) throw error
    throw providerError('PROVIDER_ERROR')
  }
}