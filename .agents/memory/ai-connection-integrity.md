---
name: AI connection integrity
description: Trust boundaries for workspace-targeted credential operations and signed provider-test metadata.
---

Credential operations must name the workspace selected in the UI and authorize that exact workspace on every server request. Never substitute another active membership when access to the selected workspace disappears.

**Why:** A user with memberships in multiple workspaces could otherwise have a pending credential action silently redirected to a different workspace after revocation. Matching provider IDs and revisions make this an integrity risk, not just a confusing UI result.

**How to apply:** Carry and check the requested workspace identity through client request, server authorization, storage mutation, and response validation; reject missing or revoked membership rather than falling back.

Normalize timestamps before signing and checking persisted provider-test status.

**Why:** PostgreSQL can serialize the same timestamp differently from the JavaScript ISO value sent to it. Comparing signatures over literal strings makes valid persisted test status unreadable after a database round trip.

**How to apply:** Sign a shared canonical timestamp representation and test the real database serialization path when adding signed status or provenance.

Reject untrusted database connection-string options when requiring verified TLS for a restricted credential reader.

**Why:** Some PostgreSQL clients let URL parameters override an explicitly supplied TLS configuration, including disabling encryption or certificate checks. A narrowly privileged login still needs a protected transport.

**How to apply:** Fail closed on connection-string options that can alter TLS, or parse validated fields and enforce verified TLS after parsing; test downgrade attempts without making a network connection.