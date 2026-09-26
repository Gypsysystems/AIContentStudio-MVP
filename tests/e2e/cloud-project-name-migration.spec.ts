import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260926000100_cloud_project_name_uniqueness.sql', 'utf8')

test('database uniqueness is workspace-scoped and includes active and staging projects', () => {
  expect(migration).toMatch(/lock table public\.cloud_projects in access exclusive mode/i)
  expect(migration).toMatch(
    /create unique index cloud_projects_workspace_name_key\s+on public\.cloud_projects\s*\(\s*workspace_id,\s*public\.normalize_cloud_project_name\(record->>'projectName'\)\s*\)/i,
  )
  expect(migration).not.toMatch(/where\s+status\s*=/i)
  expect(migration).toMatch(/cloud_schema_versions[\s\S]*values \('project-storage', 2\)/i)
})

test('existing duplicate names keep deterministic first owners and record non-destructive suffix migrations', () => {
  expect(migration).toMatch(
    /row_number\(\) over \(\s*partition by named\.workspace_id, public\.normalize_cloud_project_name\(named\.base_name\)\s*order by named\.created_at asc, named\.project_id asc\s*\)/i,
  )
  expect(migration).toMatch(/duplicate_number = 1 then base_name/i)
  expect(migration).toMatch(/candidate_name := duplicate_row\.base_name \|\| ' \(' \|\| suffix_number::text \|\| '\)'/i)
  expect(migration).toMatch(/assigned\.assigned_key = candidate_key/i)
  expect(migration).toMatch(/create table if not exists public\.cloud_project_name_migrations/i)
  expect(migration).toMatch(/previous_name text[\s\S]*assigned_name text not null/i)
  expect(migration).toMatch(/jsonb_set\([\s\S]*'\{projectName\}'[\s\S]*rewrite\.assigned_name/i)
  expect(migration).not.toMatch(/delete from public\.cloud_projects/i)
})

test('SQL whitespace normalization covers ECMAScript whitespace including NBSP and BOM', () => {
  for (const escape of [
    '\\0020', '\\00A0',
    '\\1680', '\\2028', '\\2029',
    '\\202F', '\\205F', '\\3000', '\\FEFF',
  ]) {
    expect(migration).toContain(escape)
  }
  expect(migration).toContain('\\0009-\\000D')
  expect(migration).toContain('\\2000-\\200A')
  expect(migration).toMatch(/regexp_replace\([\s\S]*U&'\[[\s\S]*FEFF\]\+'/i)
  expect(migration).toMatch(/pg_catalog\.btrim\([\s\S]*regexp_replace/i)
})

test('legacy malformed project names are repaired and renamed rows advance both revisions', () => {
  expect(migration).toMatch(
    /jsonb_typeof\(project\.record->'projectName'\) = 'string'[\s\S]*then project\.record->>'projectName'[\s\S]*else 'Untitled Project'/i,
  )
  expect(migration).toMatch(/jsonb_set\([\s\S]*'\{recordRevision\}'[\s\S]*project\.record_revision \+ 1/i)
  expect(migration).toMatch(/record_revision = project\.record_revision \+ 1/i)
})