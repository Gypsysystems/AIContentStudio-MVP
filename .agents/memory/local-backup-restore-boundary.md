---
name: Local backup restore boundary
description: Safety decisions for untrusted local project archives and explicit replacement.
---

A backup checksum proves only that archived bytes match their manifest. Before any restore write, validate both structure and the nested state consumed by project hydration; a valid checksum can otherwise make a replaced project impossible to open.

**Why:** Top-level shape checks missed malformed theme, review, and author metadata nested in otherwise checksummed archives. Replacement is destructive, so these failures must be caught without modifying the destination.

**How to apply:** Keep validation read-only and run it again immediately before the atomic project-and-files transaction. Preserve legacy missing-field semantics rather than filling in empty values. As-new restore must remap file-backed provenance while preserving stable topic identity; replacement must require the existing project's name, its revision, and the destination file-ID set observed at confirmation. A file can be added or removed without changing the project record revision, so revision alone is insufficient.