import { expect, test } from '@playwright/test'
import { discoverProviderModels } from '../../server/aiProviderDiscovery'

function fetchResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function mockedFetch(response: Response | Error, capture?: (url: string, init: RequestInit) => void): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {})
    if (response instanceof Error) throw response
    return response
  }) as typeof fetch
}

test('provider discovery uses fixed HTTPS endpoints and provider-specific authentication', async () => {
  const cases = [
    {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: 'Bearer fixture-token' },
      payload: { data: [{ id: 'zeta' }, { id: 'alpha' }] },
      expected: [
        { providerId: 'openai', id: 'alpha', label: 'alpha' },
        { providerId: 'openai', id: 'zeta', label: 'zeta' },
      ],
    },
    {
      provider: 'anthropic',
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: { 'x-api-key': 'fixture-token', 'anthropic-version': '2023-06-01' },
      payload: { data: [{ id: 'claude-z', display_name: 'Claude Z' }] },
      expected: [{ providerId: 'anthropic', id: 'claude-z', label: 'Claude Z' }],
    },
    {
      provider: 'google',
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      headers: { 'x-goog-api-key': 'fixture-token' },
      payload: { models: [
        { name: 'models/gemini-z', displayName: 'Gemini Z', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      ] },
      expected: [{ providerId: 'google', id: 'gemini-z', label: 'Gemini Z' }],
    },
  ]

  for (const item of cases) {
    let request: { url: string; init: RequestInit } | undefined
    const result = await discoverProviderModels(item.provider, 'fixture-token',
      mockedFetch(fetchResponse(item.payload), (url, init) => { request = { url, init } }))
    expect(result).toEqual({ state: 'available', models: item.expected })
    expect(request?.url).toBe(item.url)
    expect(request?.url).not.toContain('fixture-token')
    expect(request?.init.method).toBe('GET')
    expect(request?.init.headers).toEqual(item.headers)
    expect(request?.init.redirect).toBe('error')
    expect(request?.init.cache).toBe('no-store')
    expect(request?.init.signal).toBeInstanceOf(AbortSignal)
  }
})

test('unsupported providers do not make a request', async () => {
  let called = false
  const result = await discoverProviderModels('unknown', 'fixture-token', (async () => {
    called = true
    return fetchResponse({})
  }) as typeof fetch)
  expect(result).toEqual({ state: 'unsupported', models: [] })
  expect(called).toBe(false)
})

test('HTTP failures distinguish authentication from service unavailability', async () => {
  for (const status of [401, 403]) {
    expect(await discoverProviderModels('openai', 'fixture-token', mockedFetch(fetchResponse({}, status))))
      .toEqual({ state: 'auth-failed', models: [] })
  }
  for (const status of [400, 404, 429, 500, 503, 302]) {
    expect(await discoverProviderModels('openai', 'fixture-token', mockedFetch(fetchResponse({}, status))))
      .toEqual({ state: 'unavailable', models: [] })
  }
})

test('redirect rejection and network or timeout errors fail safely', async () => {
  let redirectMode: RequestRedirect | undefined
  const redirect = (async (_input: string | URL | Request, init?: RequestInit) => {
    redirectMode = init?.redirect
    throw new TypeError('redirect rejected')
  }) as typeof fetch
  expect(await discoverProviderModels('anthropic', 'fixture-token', redirect))
    .toEqual({ state: 'unavailable', models: [] })
  expect(redirectMode).toBe('error')

  for (const error of [new Error('network failure'), Object.assign(new Error('timed out'), { name: 'AbortError' })]) {
    expect(await discoverProviderModels('google', 'fixture-token', mockedFetch(error)))
      .toEqual({ state: 'unavailable', models: [] })
  }
})

test('malformed and oversized successful responses fail closed', async () => {
  const malformed = [
    'not-json',
    {},
    { data: {} },
    { data: [null] },
    { data: [{ id: '' }] },
    { data: [{ id: 'bad id' }] },
    { data: [{ id: 'x', display_name: 2 }] },
  ]
  for (const payload of malformed) {
    const response = typeof payload === 'string'
      ? new Response(payload, { status: 200 })
      : fetchResponse(payload)
    expect(await discoverProviderModels('anthropic', 'fixture-token', mockedFetch(response)))
      .toEqual({ state: 'unavailable', models: [] })
  }

  const oversized = new Response(' '.repeat(2_000_001), { status: 200 })
  expect(await discoverProviderModels('openai', 'fixture-token', mockedFetch(oversized)))
    .toEqual({ state: 'unavailable', models: [] })
})

test('Google payloads are validated and only generateContent models are returned', async () => {
  const payload = { models: [
    { name: 'models/gemini-2', displayName: 'Gemini 2', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embed', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/bad', displayName: 'Bad', supportedGenerationMethods: ['generateContent', 42] },
  ] }
  expect(await discoverProviderModels('google', 'fixture-token', mockedFetch(fetchResponse(payload))))
    .toEqual({ state: 'unavailable', models: [] })

  const valid = { models: [
    { name: 'models/gemini-2', displayName: 'Gemini 2', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embed', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] },
  ] }
  expect(await discoverProviderModels('google', 'fixture-token', mockedFetch(fetchResponse(valid))))
    .toEqual({ state: 'available', models: [{ providerId: 'google', id: 'gemini-2', label: 'Gemini 2' }] })
})

test('duplicate models are deduplicated deterministically and model counts are bounded', async () => {
  const duplicatePayload = { data: [
    { id: 'same', display_name: 'Zed' },
    { id: 'same', display_name: 'Alpha' },
    { id: 'other', display_name: 'Other' },
  ] }
  expect(await discoverProviderModels('anthropic', 'fixture-token', mockedFetch(fetchResponse(duplicatePayload))))
    .toEqual({ state: 'available', models: [
      { providerId: 'anthropic', id: 'other', label: 'Other' },
      { providerId: 'anthropic', id: 'same', label: 'Alpha' },
    ] })

  const tooMany = { data: Array.from({ length: 1001 }, (_, index) => ({ id: `model-${index}` })) }
  expect(await discoverProviderModels('openai', 'fixture-token', mockedFetch(fetchResponse(tooMany))))
    .toEqual({ state: 'unavailable', models: [] })
})

test('a provider cannot echo a credential through discovered metadata', async () => {
  const secret = 'fixture-private-token'
  expect(await discoverProviderModels('anthropic', secret, mockedFetch(fetchResponse({
    data: [{ id: 'valid-model', display_name: `Model ${secret}` }],
  })))).toEqual({ state: 'unavailable', models: [] })
  expect(await discoverProviderModels('openai', secret, mockedFetch(fetchResponse({
    data: [{ id: secret }],
  })))).toEqual({ state: 'unavailable', models: [] })
})