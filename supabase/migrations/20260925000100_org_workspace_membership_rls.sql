-- Tenant identity, workspace membership, and authenticated read policies.
-- Tenant bootstrap is deliberately reserved for a trusted service-role backend.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_memberships_by_user
  on public.workspace_memberships (user_id, workspace_id);

-- The auth trigger creates only the profile linked to the newly created user.
-- It never creates an organization, workspace, or privileged membership.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$function$;

revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.handle_new_auth_user() from anon, authenticated;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Ensure users that predate this migration also have linked profile records.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

-- Authenticated users can read their own profile and update only its
-- user-editable display name. The id and timestamps are not client-writable.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- This is the trusted membership lookup path: the JWT subject is supplied by
-- auth.uid(), never by a client-provided user_id filter or role claim.
drop policy if exists workspace_memberships_select_self on public.workspace_memberships;
create policy workspace_memberships_select_self
  on public.workspace_memberships for select to authenticated
  using (user_id = (select auth.uid()));

-- Memberships and tenant containers are provisioned/changed only by a trusted
-- backend using service_role. There are intentionally no authenticated write
-- policies, so a member cannot promote themself or add another member.
drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
  on public.workspaces for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_memberships as membership
      where membership.workspace_id = workspaces.id
        and membership.user_id = (select auth.uid())
    )
  );

drop policy if exists orgs_select_workspace_member on public.orgs;
create policy orgs_select_workspace_member
  on public.orgs for select to authenticated
  using (
    exists (
      select 1
      from public.workspaces as workspace
      join public.workspace_memberships as membership
        on membership.workspace_id = workspace.id
      where workspace.org_id = orgs.id
        and membership.user_id = (select auth.uid())
    )
  );

revoke all on public.profiles, public.orgs, public.workspaces, public.workspace_memberships
  from public, anon, authenticated;
grant select on public.profiles, public.orgs, public.workspaces, public.workspace_memberships
  to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Trusted provisioning entry point. Do not grant this to authenticated users:
-- accepting an arbitrary auth user id here would otherwise enable self-service
-- creation of organizations and owner memberships.
create or replace function public.bootstrap_organization(
  p_owner_user_id uuid,
  p_organization_name text,
  p_workspace_name text
)
returns table (organization_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  created_org_id uuid;
  created_workspace_id uuid;
begin
  if p_owner_user_id is null then
    raise exception 'Owner user id is required' using errcode = '22023';
  end if;
  if p_organization_name is null
    or char_length(btrim(p_organization_name)) not between 1 and 200 then
    raise exception 'Organization name must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_workspace_name is null
    or char_length(btrim(p_workspace_name)) not between 1 and 200 then
    raise exception 'Workspace name must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_owner_user_id) then
    raise exception 'Owner must be an existing auth user' using errcode = '22023';
  end if;

  insert into public.profiles (id)
  values (p_owner_user_id)
  on conflict (id) do nothing;

  insert into public.orgs (name)
  values (btrim(p_organization_name))
  returning id into created_org_id;

  insert into public.workspaces (org_id, name)
  values (created_org_id, btrim(p_workspace_name))
  returning id into created_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (created_workspace_id, p_owner_user_id, 'owner');

  return query select created_org_id, created_workspace_id;
end;
$function$;

revoke all on function public.bootstrap_organization(uuid, text, text) from public;
revoke all on function public.bootstrap_organization(uuid, text, text) from anon, authenticated;
grant execute on function public.bootstrap_organization(uuid, text, text) to service_role;

comment on table public.workspace_memberships is
  'Workspace roles: owner, admin, editor, viewer. Authenticated reads expose only the caller''s own rows; membership writes are trusted-backend only.';
comment on function public.bootstrap_organization(uuid, text, text) is
  'Trusted service-role provisioning only; never grant to anon or authenticated.';