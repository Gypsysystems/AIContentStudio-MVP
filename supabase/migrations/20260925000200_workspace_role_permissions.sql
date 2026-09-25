-- Canonical workspace-role authorization matrix, readable by authenticated
-- clients but writable only by trusted database/backend administrators.
create table if not exists public.workspace_role_permissions (
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  permission text not null check (
    permission in (
      'create',
      'read',
      'write',
      'delete',
      'duplicate',
      'backup',
      'restore-new',
      'replace'
    )
  ),
  primary key (role, permission)
);

alter table public.workspace_role_permissions enable row level security;

revoke all on public.workspace_role_permissions from public, anon, authenticated;
grant select on public.workspace_role_permissions to authenticated;

drop policy if exists workspace_role_permissions_read_authenticated
  on public.workspace_role_permissions;
create policy workspace_role_permissions_read_authenticated
  on public.workspace_role_permissions for select to authenticated
  using (true);

-- Keep this seed aligned with PROJECT_PERMISSIONS, EDITOR_PERMISSIONS, and
-- VIEWER_PERMISSIONS in src/ownership.ts. The composite primary key and
-- conflict handler make reapplication safe without replacing existing rows.
insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'create'),
  ('owner', 'read'),
  ('owner', 'write'),
  ('owner', 'delete'),
  ('owner', 'duplicate'),
  ('owner', 'backup'),
  ('owner', 'restore-new'),
  ('owner', 'replace'),
  ('admin', 'create'),
  ('admin', 'read'),
  ('admin', 'write'),
  ('admin', 'delete'),
  ('admin', 'duplicate'),
  ('admin', 'backup'),
  ('admin', 'restore-new'),
  ('admin', 'replace'),
  ('editor', 'create'),
  ('editor', 'read'),
  ('editor', 'write'),
  ('editor', 'duplicate'),
  ('editor', 'backup'),
  ('editor', 'restore-new'),
  ('viewer', 'read'),
  ('viewer', 'backup')
on conflict (role, permission) do nothing;

comment on table public.workspace_role_permissions is
  'Canonical role-to-project-permission matrix. Authenticated clients may read; client writes are revoked and no write policies exist.';