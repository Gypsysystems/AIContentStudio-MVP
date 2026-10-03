import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { rootCertificates } from 'node:tls'
import { expect, test } from '@playwright/test'
import { loadConfigFromFile } from 'vite'
import {
  handleSupabaseAuthRequest,
  isLocalDevAllowed,
} from '../../server/supabaseProjectAccess'
import { projectAccessPlugin } from '../../server/projectAccessPlugin'
import { readerSslConfig } from '../../server/aiConnectionsApi'
import { workerDatabaseConfig } from '../../server/generateTopicWorker'

const viteConfigPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function middlewareServer(middlewares: Middleware[]) {
  return {
    middlewares: {
      use(handler: Middleware) {
        middlewares.push(handler)
      },
    },
  }
}

function dispatch(
  middlewares: Middleware[],
  request: IncomingMessage,
): { status: number; body: string; headers: Map<string, unknown> } {
  let statusCode = 200
  let body = ''
  const headers = new Map<string, unknown>()
  const response = {
    get statusCode() { return statusCode },
    set statusCode(value: number) { statusCode = value },
    setHeader(name: string, value: unknown) { headers.set(name.toLowerCase(), value) },
    end(value?: string) { body = value ?? '' },
    get headersSent() { return body.length > 0 },
  } as unknown as ServerResponse
  const requestAt = (index: number): void => {
    if (index >= middlewares.length || body.length > 0) return
    middlewares[index](request, response, () => requestAt(index + 1))
  }
  requestAt(0)
  return { status: statusCode, body, headers }
}

function middlewareRequest(
  url: string,
  method: string,
  options: {
    host?: string
    origin?: string
    contentType?: string
    remoteAddress?: string
  } = {},
): IncomingMessage {
  return {
    url,
    method,
    headers: {
      host: options.host ?? 'localhost:4173',
      origin: options.origin ?? 'http://localhost:4173',
      'content-type': options.contentType ?? 'application/json',
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    resume() { return this },
  } as unknown as IncomingMessage
}

function authRequest(
  url: string,
  body: unknown,
  headers: IncomingMessage['headers'] = {},
): IncomingMessage {
  const request = new EventEmitter() as EventEmitter & Partial<IncomingMessage>
  request.url = url
  request.method = 'POST'
  request.headers = {
    host: 'localhost:4173',
    origin: 'http://localhost:4173',
    'content-type': 'application/json',
    ...headers,
  }
  request.socket = {} as IncomingMessage['socket']
  request.resume = () => request as IncomingMessage
  queueMicrotask(() => {
    request.emit('data', JSON.stringify(body))
    request.emit('end')
  })
  return request as IncomingMessage
}

async function callAuth(request: IncomingMessage) {
  const headers = new Map<string, unknown>()
  let status = 0
  let body = ''
  const responseObject = {
    statusCode: 0,
    setHeader(name: string, value: unknown) { headers.set(name.toLowerCase(), value) },
    end(value?: string) {
      body = value ?? ''
      status = responseObject.statusCode
    },
    get headersSent() { return body.length > 0 },
  }
  const response = responseObject as unknown as ServerResponse
  await handleSupabaseAuthRequest(request, response)
  return { status, body: JSON.parse(body) as Record<string, unknown>, headers }
}

function installPluginHook(hook: unknown, server: unknown): void {
  const callback = typeof hook === 'function'
    ? hook
    : hook && typeof hook === 'object' && 'handler' in hook
      ? hook.handler
      : undefined
  if (typeof callback === 'function') {
    const handler = callback as (server: unknown) => void
    handler(server)
  }
}

test.describe('local and production configuration boundaries', () => {
  test.describe.configure({ mode: 'serial' })

  test('Vite keeps development inline sourcemaps but production builds disable maps and minify', async () => {
    const configFor = async (mode: string) => {
      const loaded = await loadConfigFromFile({
        command: 'build',
        mode,
        isSsrBuild: false,
        isPreview: false,
      }, viteConfigPath)
      expect(loaded).not.toBeNull()
      return loaded!.config.build
    }

    const development = await configFor('development')
    expect(development?.sourcemap).toBe('inline')
    expect(development?.minify).toBe(false)

    const production = await configFor('production')
    expect(production?.sourcemap).toBe(false)
    expect(production?.minify).toBe(true)
  })

  test('the fixed local identity requires explicit opt-in and is disabled in production', async () => {
    await withEnvironment({ NODE_ENV: 'development', LOCAL_DEV_AUTH: 'true' }, () => {
      expect(isLocalDevAllowed()).toBe(true)
    })
    await withEnvironment({ NODE_ENV: 'development', LOCAL_DEV_AUTH: undefined }, () => {
      expect(isLocalDevAllowed()).toBe(false)
    })
    await withEnvironment({ NODE_ENV: 'production', LOCAL_DEV_AUTH: 'true' }, () => {
      expect(isLocalDevAllowed()).toBe(false)
    })
  })

  test('local development identity is restricted to loopback connections', async () => {
    await withEnvironment({ NODE_ENV: 'development', LOCAL_DEV_AUTH: 'true' }, () => {
      const middlewares: Middleware[] = []
      const plugin = projectAccessPlugin()
      installPluginHook(plugin.configureServer, middlewareServer(middlewares))

      const remote = dispatch(middlewares, middlewareRequest('/api/auth/session', 'POST', {
        remoteAddress: '203.0.113.25',
      }))
      expect(remote.status).toBe(403)
      expect(JSON.parse(remote.body)).toMatchObject({ code: 'LOCAL_DEV_PRIVATE_ONLY' })

      const loopback = dispatch(middlewares, middlewareRequest('/api/auth/session', 'POST'))
      expect(loopback.status).toBe(200)
      expect(JSON.parse(loopback.body)).toEqual({ authenticated: true, mode: 'local-dev' })
    })
  })

  test('production Supabase cookies are Secure, HttpOnly and SameSite=Lax; forged origins are rejected', async () => {
    await withEnvironment({
      NODE_ENV: 'production',
      LOCAL_DEV_AUTH: undefined,
      SUPABASE_URL: 'https://supabase.fixture.invalid',
      SUPABASE_ANON_KEY: 'fixture-public-anon-key',
    }, async () => {
      const originalFetch = globalThis.fetch
      const calls: string[] = []
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        calls.push(url.pathname)
        if (url.pathname === '/auth/v1/token') {
          return Response.json({
            access_token: 'fixture-access-token',
            refresh_token: 'fixture-refresh-token',
            expires_in: 3600,
          })
        }
        if (url.pathname === '/auth/v1/user') return Response.json({ id: 'fixture-user' })
        if (url.pathname === '/rest/v1/workspace_memberships') {
          return Response.json([{ workspace_id: 'fixture-workspace', role: 'owner' }])
        }
        if (url.pathname === '/rest/v1/workspaces') {
          return Response.json([{
            id: 'fixture-workspace',
            name: 'Fixture Workspace',
            orgs: { name: 'Fixture Organization' },
          }])
        }
        throw new Error(`Unexpected synthetic Supabase endpoint: ${url.pathname}`)
      }) as typeof fetch

      try {
        const login = await callAuth(authRequest('/api/auth/login', {
          email: 'fixture@example.test',
          password: 'synthetic-fixture-password',
        }))
        expect(login.status).toBe(200)
        expect(login.body).toMatchObject({ authenticated: true, userId: 'fixture-user' })
        expect(JSON.stringify(login.body)).not.toContain('fixture-access-token')
        const cookies = login.headers.get('set-cookie') as string[]
        expect(cookies).toHaveLength(2)
        for (const cookie of cookies) {
          expect(cookie).toContain('HttpOnly')
          expect(cookie).toContain('SameSite=Lax')
          expect(cookie).toContain('Secure')
        }
        expect(calls).toEqual([
          '/auth/v1/token',
          '/auth/v1/user',
          '/rest/v1/workspace_memberships',
          '/rest/v1/workspaces',
        ])

        const beforeForgery = calls.length
        const forged = await callAuth(authRequest('/api/auth/session', {}, {
          origin: 'https://attacker.fixture.invalid',
        }))
        expect(forged.status).toBe(403)
        expect(forged.body).toMatchObject({ code: 'ORIGIN_REJECTED' })
        expect(calls).toHaveLength(beforeForgery)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  test('reader and worker TLS config rejects malformed certificates and connection-string options', async () => {
    expect(readerSslConfig(undefined)).toEqual({ rejectUnauthorized: true })
    expect(readerSslConfig(rootCertificates[0]).rejectUnauthorized).toBe(true)
    expect(() => readerSslConfig('not a certificate')).toThrow()

    await withEnvironment({
      GENERATE_TOPIC_WORKER_DATABASE_CA: undefined,
      AI_CONNECTION_DATABASE_CA: undefined,
    }, () => {
      const validWorkerUrl = 'postgresql://generate_topic_worker:fixture-password@db.fixture.invalid/worker'
      expect(workerDatabaseConfig(validWorkerUrl).ssl)
        .toEqual({ rejectUnauthorized: true })
      for (const option of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=require']) {
        expect(() => workerDatabaseConfig(`${validWorkerUrl}?${option}`)).toThrow()
      }
      expect(() => workerDatabaseConfig(validWorkerUrl, 'not a certificate')).toThrow()
    })
  })

  test('preview installs auth and cloud handlers while legacy project-access remains unavailable', () => {
    const middlewares: Middleware[] = []
    const plugin = projectAccessPlugin()
    installPluginHook(plugin.configurePreviewServer, middlewareServer(middlewares))

    const auth = dispatch(middlewares, middlewareRequest('/api/auth/session', 'GET'))
    expect(auth.status).toBe(405)
    expect(JSON.parse(auth.body)).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })

    const cloudProjects = dispatch(middlewares, middlewareRequest('/api/cloud-projects', 'GET'))
    expect(cloudProjects.status).toBe(405)
    expect(cloudProjects.headers.get('allow')).toBe('POST')

    const legacyAccess = dispatch(middlewares, middlewareRequest('/api/project-access', 'GET'))
    expect(legacyAccess.status).toBe(503)
    expect(JSON.parse(legacyAccess.body)).toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' })
  })

  test('HTML script slots come from build configuration and the configured title is escaped', async () => {
    const loaded = await loadConfigFromFile({
      command: 'build',
      mode: 'production',
      isSsrBuild: false,
      isPreview: false,
    }, viteConfigPath)
    expect(loaded).not.toBeNull()

    const source = await readFile(viteConfigPath, 'utf8')
    expect(source).toContain('figmaSiteConfiguration(siteConfiguration)')
    expect(source).toContain("const headStart = config.customScripts?.headStart ?? ''")
    expect(source).toContain("replaceHtmlCommentSlot(result, 'figma:head-start', headStart)")
    expect(source).toContain("replaceHtmlCommentSlot(result, 'figma:title', escapeHtmlText(title))")

    const siteConfig = JSON.parse(await readFile(
      fileURLToPath(new URL('../../.figma/make/site.json', import.meta.url)),
      'utf8',
    )) as { title?: string; customScripts?: Record<string, string> }
    expect(siteConfig.title).toBe('AI Content Studio')
    expect(siteConfig.customScripts).toBeUndefined()
    const pluginOptions = (loaded!.config.plugins ?? []) as unknown as unknown[]
    const plugin = pluginOptions.flat(Infinity).find((entry: unknown) =>
      entry !== null && typeof entry === 'object'
        && 'name' in entry && entry.name === 'figma-site-configuration',
    )
    expect(plugin).toBeDefined()
    const htmlPlugin = plugin as {
      transformIndexHtml: {
        handler(html: string): { html: string }
      }
    }
    const transformed = htmlPlugin.transformIndexHtml.handler(
      '<html lang="<!-- figma:lang -->"><head><title><!-- figma:title --></title><!-- figma:head-start --></head><body><!-- figma:body-start --></body></html>',
    )
    expect(transformed.html).toContain('<title>AI Content Studio</title>')
    expect(transformed.html).not.toContain('<script')
  })
})