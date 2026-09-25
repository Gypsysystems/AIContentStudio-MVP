---
name: Server-authorized local bridge
description: Security and migration limits while project content remains browser-owned.
---

Keep session verification, current membership lookup, and project ownership metadata on the server. The app's local persistence adapter may ask the server to authorize actions, but it must not send role or workspace claims as authority. Without a configured trusted verifier the production API must fail closed.

**Why:** A server cannot prove the origin, integrity, or confidentiality of browser IndexedDB content, even if its separate ownership metadata is trustworthy. The fixed local-development identity is not authentication, and a public development preview does not become private through an Origin check. Browser metadata enrollment of existing projects is safe only as an explicitly dev-only compatibility measure for the fixed local user; never silently use it for cloud tenancy.

**How to apply:** Before enabling shared or cloud-backed projects, introduce real trusted session and membership providers plus server-owned content storage and an explicit migration plan. Keep backup-as-new portable, authorize replacement against the destination, and make client operations fail rather than fall back to local permissions when the server gate is unavailable. Treat asynchronous authorization as a prerequisite for UI navigation and project activation.