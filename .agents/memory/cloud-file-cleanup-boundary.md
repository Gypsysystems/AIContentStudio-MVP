---
name: Cloud file cleanup boundary
description: Safe recovery when cloud project metadata and private object storage change in separate transactions.
---

Treat file deletion and restore abandonment as a retryable two-system operation. Keep metadata that authorizes object deletion until the object is confirmed absent; prevent a direct project-row cascade from removing that authority. Storage policies may need narrowly scoped SELECT as well as DELETE to allow authenticated removal.

**Why:** PostgreSQL project/file metadata and private object storage cannot commit atomically. Deleting metadata first can strand private bytes permanently, and Supabase Storage object deletion may need visibility to the same object before DELETE is effective.

**How to apply:** For replacement, deletion, failed uploads, and abandoned imports, preserve cleanup metadata, retry object removal, confirm absence, then remove the metadata. Test these transitions with authenticated roles against an actual migrated Storage service, not only mocked requests.