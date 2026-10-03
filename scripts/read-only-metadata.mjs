import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

// Returns only a decision; connection strings and project references never
// leave the runtime-held configuration boundary.
export function assessReaderTarget(reader, supabase) {
  try {
    const app = new URL(supabase)
    const db = new URL(reader)
    const match = app.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)
    if (!match || app.protocol !== "https:" || app.username || app.password
      || !["postgres:", "postgresql:"].includes(db.protocol) || !db.password
      || db.search || db.hash || db.pathname !== "/postgres")
      return { ready: false, reason: "TARGET_UNCERTAIN" }
    const project = match[1]
    const direct = db.hostname === `db.${project}.supabase.co`
      && db.username === "ai_connection_reader"
    const pooled = db.hostname.endsWith(".pooler.supabase.com")
      && db.username === `ai_connection_reader.${project}`
    return direct || pooled
      ? { ready: true, reason: "CONFIGURED_TARGET_MATCHES" }
      : { ready: false, reason: "TARGET_UNCERTAIN" }
  } catch {
    return { ready: false, reason: "TARGET_UNCERTAIN" }
  }
}

async function repositoryCatalogNames() {
  const tables = new Set()
  const functions = new Set()
  for (const name of await readdir("supabase/migrations")) {
    if (!name.endsWith(".sql")) continue
    const text = await readFile(`supabase/migrations/${name}`, "utf8")
    for (const match of text.matchAll(/create table(?: if not exists)? public\.([a-z_]+)/giu))
      tables.add(match[1])
    for (const match of text.matchAll(/create or replace function public\.([a-z_]+)/giu))
      functions.add(match[1])
  }
  return { tables: [...tables].sort(), functions: [...functions].sort() }
}

async function probe() {
  const decision = assessReaderTarget(
    process.env.AI_CONNECTION_DATABASE_URL, process.env.SUPABASE_URL,
  )
  const summary = {
    scope: "catalog-only; narrow reader; no application/connection/storage rows",
    status: "unverified",
    target: decision.reason,
    storageEnforcement: "not queried or inferred",
    workerApplicationTls: "not inferred from reader connection",
  }
  if (!decision.ready) return summary

  // Same extension resolution as the existing native-TypeScript worker, but
  // import only the pure TLS helper, never the worker/operational entrypoint.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) && context.parentURL) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(`${specifier}.ts`, context)
      }
      return nextResolve(specifier, context)
    },
  })
  let client
  try {
    const { readerSslConfig } = await import("../server/aiConnectionsApi.ts")
    client = new Client({
      connectionString: process.env.AI_CONNECTION_DATABASE_URL,
      ssl: readerSslConfig(process.env.AI_CONNECTION_DATABASE_CA),
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    })
    await client.connect()
    await client.query("BEGIN READ ONLY")
    const identity = (await client.query(`
      SELECT current_user = 'ai_connection_reader' AS intended_role,
        current_database() = 'postgres' AS intended_database,
        current_setting('server_version') AS version,
        r.rolsuper, r.rolbypassrls
      FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
    `)).rows[0]
    if (!identity?.intended_role || !identity.intended_database
      || identity.rolsuper || identity.rolbypassrls) {
      summary.target = "ROLE_OR_DATABASE_UNCERTAIN"
      return summary
    }
    summary.identity = {
      intendedRole: true, intendedDatabase: true, superuser: false, bypassRls: false,
      version: /^\d+(?:\.\d+)*(?:\s|$)/u.exec(identity.version)?.[0].trim() ?? "unverified",
    }
    const names = await repositoryCatalogNames()
    summary.tables = (await client.query(`
      SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
        pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS table_select,
        pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT') AS column_select,
        pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT') AS reader_insert,
        pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE') AS reader_update,
        pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE') AS reader_delete,
        (SELECT count(*)::integer FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        AND c.relkind IN ('r', 'p') ORDER BY c.relname
    `, [names.tables])).rows
    summary.missingTables = names.tables.filter(name => !summary.tables.some(row => row.name === name))
    summary.functions = (await client.query(`
      SELECT DISTINCT p.proname AS name, p.prosecdef AS security_definer,
        pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE') AS reader_execute
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[]) ORDER BY p.proname
    `, [names.functions])).rows
    summary.missingFunctions = names.functions.filter(
      name => !summary.functions.some(row => row.name === name),
    )
    summary.storageCatalog = (await client.query(`
      SELECT c.relname AS name, c.relrowsecurity AS rls,
        pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE') AS reader_schema_usage,
        pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS reader_select,
        (SELECT count(*)::integer FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname IN ('buckets', 'objects') ORDER BY c.relname
    `)).rows
    summary.postgresBackendTls = (await client.query(`
      SELECT ssl, version, cipher, bits FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()
    `)).rows[0] ?? { ssl: null }
    // A pooler's backend pg_stat_ssl row does not describe the client's
    // frontend TLS socket. Keep both observations separate.
    const socket = client.connection.stream
    summary.readerFrontendTls = {
      encrypted: socket.encrypted === true,
      certificateVerified: socket.authorized === true,
      protocol: socket.getProtocol?.() ?? null,
      cipher: socket.getCipher?.().standardName ?? socket.getCipher?.().name ?? null,
    }
    summary.status = "metadata-observed; behavioral enforcement remains unverified"
    return summary
  } catch {
    // Never include server messages, connection options, records, or raw errors.
    summary.status = "unverified"
    summary.reason = "READER_OR_METADATA_UNAVAILABLE"
    return summary
  } finally {
    if (client) {
      await client.query("ROLLBACK").catch(() => {})
      await client.end().catch(() => {})
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length) {
    console.error("This bounded metadata probe accepts no arguments.")
    process.exitCode = 2
  } else {
    console.log(JSON.stringify(await probe(), null, 2))
  }
}