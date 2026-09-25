import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  new URL('../../supabase/migrations/20260925000100_org_workspace_membership_rls.sql', import.meta.url),
  'utf8',
)
const permissionsMigration = await readFile(
  new URL('../../supabase/migrations/20260925000200_workspace_role_permissions.sql', import.meta.url),
  'utf8',
)
const ownershipSource = await readFile(
  new URL('../../src/ownership.ts', import.meta.url),
  'utf8',
)

const normalizedSql = migration
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase()
const normalizedPermissionsSql = permissionsMigration
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase()

function sourcePermissionSet(constantName: string): string[] {
  const match = ownershipSource.match(
    new RegExp(`const ${constantName}:[\\s\\S]*?= new Set\\(\\[([\\s\\S]*?)\\]\\)`),
  )
  if (!match) throw new Error(`Could not find ${constantName} in src/ownership.ts`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((permission) => permission[1])
}

function seededRolePermissions(): Array<[string, string]> {
  const seed = normalizedPermissionsSql.match(
    /insert into public\.workspace_role_permissions \(role, permission\) values (.*?) on conflict \(role, permission\) do nothing/,
  )
  if (!seed) throw new Error('Could not find idempotent workspace-role permission seed')
  return [...seed[1].matchAll(/\('([^']+)', '([^']+)'\)/g)]
    .map(([, role, permission]): [string, string] => [role, permission])
}

test('Supabase tenant schema links profiles to auth users and constrains workspace roles', () => {
  expect(normalizedSql).toContain('id uuid primary key references auth.users (id) on delete cascade')
  expect(normalizedSql).toContain('create table if not exists public.orgs')
  expect(normalizedSql).toContain('create table if not exists public.workspaces')
  expect(normalizedSql).toContain('org_id uuid not null references public.orgs (id)')
  expect(normalizedSql).toContain('create table if not exists public.workspace_memberships')
  expect(normalizedSql).toContain("role in ('owner', 'admin', 'editor', 'viewer')")
  expect(normalizedSql).toContain('after insert on auth.users')
  expect(normalizedSql).toContain('insert into public.profiles (id) values (new.id)')
})

test('RLS membership lookups trust auth.uid and isolate organizations and workspaces', () => {
  expect(normalizedSql).toContain('alter table public.workspace_memberships enable row level security')
  expect(normalizedSql).toContain('on public.workspace_memberships for select to authenticated using (user_id = (select auth.uid()))')
  expect(normalizedSql).toContain('on public.workspaces for select to authenticated')
  expect(normalizedSql).toContain('membership.workspace_id = workspaces.id')
  expect(normalizedSql).toContain('on public.orgs for select to authenticated')
  expect(normalizedSql).toContain('workspace.org_id = orgs.id')
  expect(normalizedSql).toContain('membership.user_id = (select auth.uid())')
})

test('authenticated clients cannot self-provision tenants or escalate membership roles', () => {
  expect(normalizedSql).toContain('revoke all on public.profiles, public.orgs, public.workspaces, public.workspace_memberships from public, anon, authenticated')
  expect(normalizedSql).toContain('grant select on public.profiles, public.orgs, public.workspaces, public.workspace_memberships to authenticated')
  expect(normalizedSql).not.toMatch(/create policy \w+ on public\.workspace_memberships for (insert|update|delete)/)
  expect(normalizedSql).not.toMatch(/create policy \w+ on public\.(orgs|workspaces) for (insert|update|delete)/)
  expect(normalizedSql).toContain('revoke all on function public.bootstrap_organization(uuid, text, text) from anon, authenticated')
  expect(normalizedSql).toContain('grant execute on function public.bootstrap_organization(uuid, text, text) to service_role')
  expect(normalizedSql).toContain('security definer set search_path = \'\'')
  expect(normalizedSql).toContain('owner must be an existing auth user')
})

test('profiles permit only self reads and self display-name updates', () => {
  expect(normalizedSql).toContain('on public.profiles for select to authenticated using (id = (select auth.uid()))')
  expect(normalizedSql).toContain('on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()))')
  expect(normalizedSql).toContain('grant update (display_name) on public.profiles to authenticated')
})

test('workspace role permissions are authenticated-readable and client-immutable', () => {
  expect(normalizedPermissionsSql).toContain('create table if not exists public.workspace_role_permissions')
  expect(normalizedPermissionsSql).toContain('primary key (role, permission)')
  expect(normalizedPermissionsSql).toContain('alter table public.workspace_role_permissions enable row level security')
  expect(normalizedPermissionsSql).toContain('revoke all on public.workspace_role_permissions from public, anon, authenticated')
  expect(normalizedPermissionsSql).toContain('grant select on public.workspace_role_permissions to authenticated')
  expect(normalizedPermissionsSql).toContain('on public.workspace_role_permissions for select to authenticated using (true)')
  expect(normalizedPermissionsSql).not.toMatch(/create policy \w+ on public\.workspace_role_permissions for (insert|update|delete)/)
  expect(normalizedPermissionsSql).toContain('on conflict (role, permission) do nothing')
})

test('workspace role permission seed matches the authorization source matrix', () => {
  const allMatch = ownershipSource.match(
    /export const PROJECT_PERMISSIONS:[\s\S]*?= \[([\s\S]*?)\]/,
  )
  if (!allMatch) throw new Error('Could not find PROJECT_PERMISSIONS in src/ownership.ts')
  const allPermissions = [...allMatch[1].matchAll(/'([^']+)'/g)]
    .map((permission) => permission[1])
  const editorPermissions = sourcePermissionSet('EDITOR_PERMISSIONS')
  const viewerPermissions = sourcePermissionSet('VIEWER_PERMISSIONS')
  const expected = [
    ...allPermissions.map((permission): [string, string] => ['owner', permission]),
    ...allPermissions.map((permission): [string, string] => ['admin', permission]),
    ...editorPermissions.map((permission): [string, string] => ['editor', permission]),
    ...viewerPermissions.map((permission): [string, string] => ['viewer', permission]),
  ].sort(([roleA, permissionA], [roleB, permissionB]) =>
    roleA.localeCompare(roleB) || permissionA.localeCompare(permissionB))
  const actual = seededRolePermissions()
    .sort(([roleA, permissionA], [roleB, permissionB]) =>
      roleA.localeCompare(roleB) || permissionA.localeCompare(permissionB))
  expect(actual).toEqual(expected)
})