# P7 Batch 5 — Supabase identity foundation

This batch adds Supabase Auth and PostgreSQL workspace membership but **does
not move projects, source files, generated outputs, or backups from browser
IndexedDB**. Shared cloud project access remains disabled. Do not enable it
merely by setting Supabase credentials.

## Setup for a Supabase environment

1. Create or select a Supabase project. Apply both SQL files in
   `supabase/migrations/` in filename order to that project's database with
   an authorized migration/admin account. The second file records the
   workspace role/permission matrix; neither migration has been run remotely.
2. Configure server environment variables `SUPABASE_URL` (the project's
   HTTPS origin), `SUPABASE_ANON_KEY` (its public anon/publishable key), and
   `APP_ORIGIN` (the exact HTTPS origin hosting this app). Do **not** set a
   service-role key in the browser or in this app's runtime; it does not need
   one. Optional `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` expose only
   the same *public* values to browser code for future client integrations;
   current login uses same-origin server endpoints instead.
3. Create users through Supabase Auth. Provision an organization, workspace,
   and initial owner through a trusted admin/migration context using the
   service-role-only `bootstrap_organization(owner_user_id, org_name,
   workspace_name)` database function. Further membership changes also
   require a trusted administrator; the app offers no self-promotion or
   self-service provisioning. A user without a current membership cannot
   enter the workspace.
4. Verify the configured environment against the actual Supabase project
   (login, refresh, revocation and policy behavior). Offline tests cover the
   API and policy contracts but cannot prove the remote deployment or live RLS
   state. Do not claim live verification until this check is complete.

The browser sends login credentials to same-origin `/api/auth/login`; the
server exchanges them with Supabase Auth and stores access/refresh tokens in
HttpOnly cookies. On session checks it verifies the access token through
Supabase Auth and reads current membership through PostgreSQL RLS using that
user's token. Project actions are deliberately disabled in production until
content has server-owned persistence.

For direct loopback development and tests only, explicitly run with
`LOCAL_DEV_AUTH=true`. The fixed single-user project endpoints require both
a loopback Host and a loopback network peer; a remotely reachable Replit
preview is **not** authenticated by this setting. Never use it for production.
Without local mode or Supabase configuration, the app fails closed with a
sign-in-unavailable state. The hosted preview requires Supabase credentials
to display the cloud sign-in state, and shared project editing remains
disabled until cloud project storage exists.