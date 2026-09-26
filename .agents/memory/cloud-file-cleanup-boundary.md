---
name: Cloud file cleanup boundary
description: Safe recovery when cloud project metadata and private object storage change in separate transactions.
---

Treat file deletion and restore abandonment as a retryable two-system operation. Keep metadata that authorizes object deletion until the object is confirmed absent; prevent a direct project-row cascade from removing that authority. Storage policies may need narrowly scoped SELECT as well as DELETE to allow authenticated removal. For immutable archives, serialize staged-object deletion with checkpoint finalization and recheck committed state after acquiring the shared lock.

**Why:** PostgreSQL project/file metadata and private object storage cannot commit atomically. Deleting metadata first can strand private bytes permanently, and Supabase Storage object deletion may need visibility to the same object before DELETE is effective. A staged-object DELETE authorized before finalization can otherwise commit afterward and remove bytes from a newly committed checkpoint.

**How to apply:** For replacement, deletion, failed uploads, and abandoned imports, preserve cleanup metadata, retry object removal, confirm absence, then remove the metadata. When a whole project is deleted, retain a scoped tombstone authorizing both SELECT and DELETE until archive bytes are confirmed gone. Test these transitions and finalization races with authenticated roles against an actual migrated Storage service, not only mocked requests.