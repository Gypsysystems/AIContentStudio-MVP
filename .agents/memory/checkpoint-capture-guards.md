---
name: Checkpoint capture guards
description: Byte-level race prevention when making immutable local checkpoints.
---

When hashing historical files outside an IndexedDB transaction, require every live-file write to rotate a unique mutation token and compare that token inside the final transaction. Reuse the exact pre-hashed blobs for the committed checkpoint; a matching file ID, metadata, and byte size alone are insufficient.

**Why:** WebCrypto hashing suspends the transaction. Another write can replace a file with different bytes of the same size before commit, producing an archive that fails its own digest. Older rows without tokens are safe only if every later supported write supplies one.

**How to apply:** Keep digest work outside the transaction, enforce token and complete file-set/revision guards atomically at commit, and test a same-ID, same-size replacement through supported write paths.