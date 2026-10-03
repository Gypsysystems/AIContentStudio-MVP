# Local and production boundaries

Verified local configuration boundaries (synthetic fixtures only; no provider, database, or live-network calls):

- Vite development builds retain inline sourcemaps and disable minification. Production builds disable sourcemaps and enable minification.
- The fixed local identity requires `LOCAL_DEV_AUTH=true`, is unavailable when `NODE_ENV=production`, and its development endpoints require both a loopback peer and loopback Host.
- Auth requests require a canonical same-origin Origin/Host match; forwarded authority headers do not override it. Production session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`.
- Reader and worker PostgreSQL URLs reject query/fragment options that could alter TLS behavior. TLS verification remains enabled; configured CA input must parse as a certificate.
- `vite.config.ts` obtains optional raw script slot contents only from checked-in `.figma/make/site.json` build configuration. The configured title is HTML-text escaped; authored project/user data is not an input to those build-time slots.
- Preview registers its auth and cloud API middleware but leaves the legacy `/api/project-access` bridge unavailable. Existing authentication, workspace checks, and cloud storage/RLS remain separate.

Focused verification:

- `tests/e2e/local-production-boundaries.spec.ts` exercises build modes, local-only auth, origin/cookie handling, strict TLS configuration, preview route installation, and build-time HTML inputs with fixture credentials and mocked fetch.
- Existing TLS no-connect and PEM validation assertions are in `tests/e2e/ai-connections.spec.ts`; worker URL/CA validation assertions are in `tests/e2e/generate-topic-jobs-api.spec.ts`.
- Existing origin and forged forwarded-host assertions are in `tests/e2e/project-access-server.spec.ts` and `tests/e2e/ai-catalog-api.spec.ts`.