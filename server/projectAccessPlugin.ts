import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { isIP } from 'node:net'
import {
  ProjectAccessServiceError,
  type ProjectAccessService,
} from './projectAccess'
import { createLocalDevProjectAccessService } from './localDevProjectAccess'

const ENDPOINT = '/api/project-access'
const MAX_BODY_BYTES = 16 * 1024

function sendJson(
  response: ServerResponse,
  status: number,
  payload: object,
): void {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.startsWith('127.')
}

function configuredDevHostname(): string | null {
  const configured = process.env.REPLIT_DEV_DOMAIN?.trim().split(',')[0]
  if (!configured) return null
  try {
    return new URL(configured.includes('://') ? configured : `https://${configured}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Validate Origin against Host without trusting caller-controlled proxy headers. */
export function isSameOriginRequest(request: IncomingMessage): boolean {
  const originHeader = request.headers.origin
  const host = request.headers.host
  if (typeof originHeader !== 'string' || !host || host !== host.trim() || /[,/@\\\s]/.test(host)) return false
  try {
    const origin = new URL(originHeader)
    const requestAuthority = new URL(`${origin.protocol}//${host}`)
    const hostname = requestAuthority.hostname.toLowerCase()
    const trustedDevHostname = configuredDevHostname()
    const trustedHost = isLoopbackHostname(hostname)
      || (trustedDevHostname !== null && hostname === trustedDevHostname)
    const schemeAllowed = isLoopbackHostname(hostname)
      ? origin.protocol === 'http:' || origin.protocol === 'https:'
      : origin.protocol === 'https:'
    return trustedHost
      && schemeAllowed
      && (origin.protocol === 'http:' || origin.protocol === 'https:')
      && originHeader === origin.origin
      && origin.origin === requestAuthority.origin
      && !requestAuthority.username
      && !requestAuthority.password
      && !origin.username
      && !origin.password
  } catch {
    return false
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        reject(new ProjectAccessServiceError(413, 'BODY_TOO_LARGE', 'Request body exceeds the 16 KB limit'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new ProjectAccessServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON'))
      }
    })
    request.on('error', () => {
      if (!tooLarge) reject(new ProjectAccessServiceError(400, 'REQUEST_READ_FAILED', 'Could not read request body'))
    })
  })
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ProjectAccessService,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
    return
  }
  if (!isSameOriginRequest(request)) {
    sendJson(response, 403, { error: 'Same-origin request required', code: 'ORIGIN_REJECTED' })
    return
  }
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    sendJson(response, 415, { error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' })
    return
  }
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
    request.resume()
    sendJson(response, 413, { error: 'Request body exceeds the 16 KB limit', code: 'BODY_TOO_LARGE' })
    return
  }
  try {
    const input = await readJsonBody(request)
    const result = await service.execute(input, request)
    sendJson(response, 200, result)
  } catch (error) {
    if (error instanceof ProjectAccessServiceError) {
      sendJson(response, error.status, { error: error.message, code: error.code })
      return
    }
    if (error instanceof Error && error.name === 'ProjectAuthorizationError') {
      sendJson(response, 403, { error: error.message, code: 'FORBIDDEN' })
      return
    }
    sendJson(response, 503, { error: 'Project access service is unavailable', code: 'SERVICE_UNAVAILABLE' })
  }
}

function installEndpoint(server: ViteDevServer, service: ProjectAccessService): void {
  server.middlewares.use((request, response, next) => {
    if (request.url?.split('?')[0] !== ENDPOINT) return next()
    void handleRequest(request, response, service).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 503, { error: 'Project access service is unavailable', code: 'SERVICE_UNAVAILABLE' })
      }
    })
  })
}

/**
 * Dev uses a fixed local identity with no authentication and must not be
 * exposed as a public service. Production preview deliberately fails closed
 * because no real verifier provider is configured.
 */
export function projectAccessPlugin(): Plugin {
  return {
    name: 'project-access-api',
    configureServer(server) {
      installEndpoint(server, createLocalDevProjectAccessService())
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== ENDPOINT) return next()
        sendJson(response, 503, {
          error: 'Project access authentication is not configured for preview',
          code: 'AUTH_PROVIDER_UNAVAILABLE',
        })
      })
    },
  }
}