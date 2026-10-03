import assert from "node:assert/strict"
import test from "node:test"
import { assessReaderTarget } from "../../scripts/read-only-metadata.mjs"

const project = "abcdefghijklmnopqrst"
const app = `https://${project}.supabase.co`
const direct = `postgresql://ai_connection_reader:synthetic@db.${project}.supabase.co/postgres`

test("metadata target guard permits only the configured narrow reader and matching project", () => {
  assert.equal(assessReaderTarget(direct, app).ready, true)
  assert.equal(assessReaderTarget(
    `postgres://ai_connection_reader.${project}:synthetic@aws-0-test.pooler.supabase.com/postgres`,
    app,
  ).ready, true)
})

test("metadata target uncertainty and privilege/TLS overrides fail before connection", () => {
  for (const reader of [
    undefined, direct.replace(project, "differentprojectxxxx"),
    direct.replace("ai_connection_reader", "postgres"),
    direct.replace("/postgres", "/other"), `${direct}?sslmode=disable`, `${direct}#options`,
    `postgres://ai_connection_reader.${project}:synthetic@attacker.invalid/postgres`,
  ]) assert.equal(assessReaderTarget(reader, app).ready, false)
  assert.equal(assessReaderTarget(direct, "https://custom.invalid").ready, false)
  assert.equal(assessReaderTarget(direct, app.replace("https", "http")).ready, false)
  assert.equal(assessReaderTarget(direct, undefined).ready, false)
})