# Cloud project API contract (P7 Batch 6)

All routes are same-origin and use the authenticated Supabase session cookie
issued by `/api/auth/*`. Do not send a user ID, role, owner ID, or workspace ID
as authority. The server verifies the cookie with Supabase Auth, reloads current
membership, and derives the active workspace from that membership. The first
workspace in stable ID order is the active workspace for these routes. Supabase
login, refresh, and session responses include `activeRole`, derived from that
fresh membership; it is a UI hint only, never authorization authority.

## JSON endpoint

`POST /api/cloud-projects` requires `Content-Type: application/json` and a
same-origin `Origin`. It accepts exactly one `action` plus only the fields
documented for that action. Project records are opaque JSON objects: fields not
recognized by the API are preserved. On create/save/restore the server
overwrites `projectId`, `ownerUserId`, `workspaceId`, and `recordRevision`;
ownership claims in the request are never authoritative.

Successful responses are JSON and use these shapes:

| Action | Request body | Response |
| --- | --- | --- |
| `ready` | `{ "action": "ready" }` | `{ "ready": true }` only after the schema marker, required tables, and private `project-files` bucket are reachable; otherwise `{ "ready": false }` |
| `list` | `{ "action": "list" }` | `{ "projects": [ProjectRecord, ...] }` |
| `create` | `{ "action": "create", "projectId"?: string, "record": ProjectRecord }` | `{ "record": ProjectRecord }` (server uses the supplied stable ID, or generates one) |
| `read` | `{ "action": "read", "projectId": string }` | `{ "record": ProjectRecord }` |
| `save` | `{ "action": "save", "projectId": string, "expectedRevision": number, "record": ProjectRecord }` | `{ "record": ProjectRecord }` with incremented revision |
| `delete` | `{ "action": "delete", "projectId": string }` | `{ "projects": [] }` after restore stages, stored file objects, and project metadata are removed |
| `duplicate` | `{ "action": "duplicate", "projectId": string, "newProjectId"?: string, "newName"?: string }` | `{ "record": ProjectRecord }` |
| `restore-new` | `{ "action": "restore-new", "record": ProjectRecord, "fileIds": string[], "projectId"?: string }` | `{ "ready": false, "stageId": string, "projectId": string, "expectedFileIds": string[] }` |
| `restore-replace` | `{ "action": "restore-replace", "projectId": string, "record": ProjectRecord, "expectedRevision": number, "expectedFileIds": string[], "fileIds": string[] }` | `{ "ready": false, "stageId": string, "projectId": string, "expectedFileIds": string[] }` |
| `finalize-restore` | `{ "action": "finalize-restore", "stageId": string, "fileIds": string[] }` | `{ "ready": true, "record": ProjectRecord, "cleanupPending"?: boolean }` after exact-set and object-existence verification |
| `abandon-restore` | `{ "action": "abandon-restore", "stageId": string }` | `{ "abandoned": true, "projectId": string }` after staged Storage bytes and metadata are removed |
| `cleanup-files` | `{ "action": "cleanup-files", "projectId": string }` | `{ "cleanupPending": boolean, "files": string[] }` with IDs of old objects still awaiting cleanup |
| `backup` | `{ "action": "backup", "projectId": string }` | `{ "record": ProjectRecord }` |
| `load-files` | `{ "action": "load-files", "projectId": string }` | `{ "files": [FileMetadata, ...] }` |
| `load-file` | `{ "action": "load-file", "fileId": string }` | `{ "files": [FileMetadata] }` |
| `remove-file` | `{ "action": "remove-file", "fileId": string }` | `{ "files": [] }` |

`ProjectRecord` is the full project JSON object (the app's schema version 4
record today). A save is a single atomic PostgreSQL conditional update on
`project_id`, `workspace_id`, and `record_revision`. Stale revisions return
HTTP 409 `{ "code": "PROJECT_CONFLICT", "error": ... }`; the server never
silently rebases. Missing projects outside the active workspace are
indistinguishable from missing projects (404).

Stable IDs must be nonempty strings without control characters or `/` or `\`.
File ID arrays are unique and limited to 1000 values. `FileMetadata` has
`fileId`, `projectId`, `name`, `type`, `size`, and `uploadedAt`. Responses
never include internal storage paths.

## Binary file endpoint

`POST /api/cloud-files?fileId=<stable-id>` uploads the raw file bytes (not
multipart) for an active project. Required headers:

* `Origin: <same origin>`
* `X-Project-Id: <project ID>`
* `Content-Type: <file media type>` (or `application/octet-stream`)
* `X-File-Name: <percent-encoded UTF-8 filename>`
* `Content-Length: <byte count>` (maximum 100 MiB)

Normal upload response is HTTP 201:
`{ "file": { "fileId", "projectId", "name", "type", "size", "uploadedAt" } }`.
Metadata first enters a hidden `uploading` state, and becomes visible only after
the private Storage object is confirmed. Compensation is limited to resources
created by that request; duplicate-ID failures never delete an existing object
or metadata row.

For restore uploads, add `X-Stage-Id` and upload exactly each `fileId` declared
in `restore-new` or `restore-replace`. These bytes go to a private staging
namespace and do not become project files until `finalize-restore` succeeds.
Finalize requires the exact declared IDs, confirms each staged object exists,
and for replacement also rechecks both the destination record revision and
the destination's original `expectedFileIds`. Replacement uploads preserve the
source file IDs, including IDs already present on the destination: new bytes
use a unique stage-specific Storage path and separate staged metadata, so the
old metadata and bytes remain intact until the atomic finalize transaction.
Finalize moves old metadata to retryable cleanup state and activates the staged
rows; it does not silently discard old bytes. Failed cleanup remains available
through `cleanup-files` and may be retried. A failed/incomplete stage leaves the
destination unchanged; a newly staged project is hidden from normal listing
until finalized.

Use `abandon-restore` to clean up an incomplete or failed stage. The server first
closes the stage to new uploads, removes each staged private object, then asks
PostgreSQL to verify the Storage namespace is empty before deleting staged
metadata and the stage. Abandoning a new-project stage also removes its hidden
staging project. Owner/admin members may abandon any stage in their workspace;
an editor may abandon only their own new-project stage. Project deletion
automatically abandons pending stages before deleting project files.

`GET /api/cloud-files?fileId=<stable-id>` downloads bytes. It returns the
stored media type and an attachment filename; not-found and cross-workspace
objects return 404. Same-origin browsers commonly omit `Origin` on GET, so the
download route accepts an absent Origin only for this read-only method. If an
Origin is supplied it must validate as same-origin. The HttpOnly `SameSite=Lax`
session is still required, and current membership, role, workspace-scoped file
metadata, and Storage RLS are checked before bytes are returned. Uploads and all
JSON mutations require a valid same-origin Origin.

## Authorization, errors, and readiness

Roles are checked on the server against the current role-permission matrix:
owner/admin may perform all project operations; editor may create/read/write,
duplicate, backup, and restore as new; viewer may read and backup. Replacement
and deletion require owner/admin. PostgreSQL RLS independently enforces
workspace isolation and the private Storage bucket policies.
Direct project-row deletion is also guarded in PostgreSQL and fails while file
metadata or restore stages remain, preventing a cascade from stranding Storage
objects.

Errors have `{ "code": string, "error": string }`. Important statuses include
401 unauthenticated, 403 role/membership denied, 404 not found in the active
workspace, 409 optimistic-concurrency or staged-file-set conflict, 413 body or
file too large, 415 wrong JSON content type, and 503 storage/configuration not
ready. Readiness also confirms authenticated access to the complete configured
role-permission matrix. A missing migration marker/table/bucket/permission
matrix is not treated as an empty
workspace: every action except `ready` fails closed until migration
`20260925000300_cloud_project_storage.sql` is applied and the private bucket is
present.

`activeRole` returned from auth is refreshed from the current database
membership at login, refresh, and session validation. Clients may use it for
role-sensitive presentation but must not send it to authorize requests; project
and file routes independently reload the current membership and check RLS.

The cloud API does not migrate local IndexedDB data. Import is an explicit
client-side export followed by staged `restore-new`; there is no server path
that silently enrolls local records. The API does not use a service-role key.

Project deletion spans PostgreSQL and Storage, which do not share a transaction.
If Storage rejects removal partway through, the API returns an explicit 503 and
retains the project row; already-removed objects cannot be restored by the
server. Retry deletion after resolving the Storage failure. Save and staged
restore record/file-set changes, by contrast, use atomic PostgreSQL operations.