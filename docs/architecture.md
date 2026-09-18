# Architecture

This repository is more than a static Hugo site: it is a small publishing platform with content synchronization, build-time validation, and edge services. This document records the boundaries that should remain stable as the repository evolves.

## System map

```text
Content source
    |
    v
sync.mjs / scripts
    |
    v
Hugo content + data + assets
    |
    v
validation / QA workflows
    |
    v
Hugo build
    |
    v
published site
```

Two edge-service areas live under `workers/`:

- `workers/huikai-comments/`: comment submission, moderation/lifecycle, abuse controls, and persistence.
- `workers/notion-media-gateway/`: server-side media access/gateway responsibilities so browser clients do not need direct access to upstream secrets.

## Architectural boundaries

### Publishing pipeline

Content ingestion and publication are separate stages. A synchronization change should be testable without requiring an unrelated Worker change, and a Worker change should not silently mutate generated site content.

### Browser / server boundary

Secrets and privileged credentials belong on the server/Worker side. Browser-visible code should receive only the minimum data needed for the current operation.

### Comments domain

Keep request processing separated conceptually into:

```text
normalize
  -> authenticate / anti-abuse
  -> validate
  -> authorize
  -> domain operation
  -> persist
  -> serialize
  -> audit/observe
```

This keeps lifecycle rules, transport details, and persistence concerns from collapsing into one handler.

### Media gateway

The media gateway is an isolation boundary. Changes should preserve same-origin behavior where relied upon and avoid moving upstream credentials or privileged fetch logic into browser code.

## Repository invariants

A change should preserve these invariants unless the pull request explicitly proposes an architectural change:

1. Secrets are not committed or exposed to browser code.
2. Generated/published content can be reproduced from repository inputs and the documented sync path.
3. Worker responsibilities remain isolated from Hugo rendering concerns.
4. Validation failures block publication rather than being silently ignored.
5. Article/content identity is handled consistently across sync, rendering, comments, and publication checks.
6. Destructive or externally visible operations are explicit in scripts and workflows.
7. Production-specific assumptions are documented close to the workflow or service that depends on them.

## Change checklist

Before merging a structural change, verify the relevant subset:

- [ ] Sync is idempotent for unchanged input.
- [ ] Hugo build still succeeds.
- [ ] Multilingual routes still resolve.
- [ ] Comment lifecycle behavior is unchanged or intentionally versioned.
- [ ] Media access still respects the intended browser/server trust boundary.
- [ ] No new secret is exposed through generated files, logs, client JavaScript, or workflow output.
- [ ] Existing QA/deployment gates still cover the modified path.
- [ ] Rollback is possible by reverting the commit or deployment.

## When to split a module

Split code when one of these becomes true:

- it owns a distinct security boundary;
- it has a separate lifecycle or persistence model;
- it needs independent tests/deployment;
- unrelated features repeatedly modify the same large file;
- the public contract can be stated more clearly than the current implementation boundary.

Do not split code only to mirror a framework or another repository. Boundaries should follow this site's actual operational responsibilities.
