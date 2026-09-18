# huikai79.github.io

Source repository for HUIKAI's multilingual Hugo publishing platform.

This repository combines:

- Hugo site rendering;
- Notion-backed content synchronization;
- multilingual routing and translation workflows;
- media localization and rights checks;
- comments and media gateway Cloudflare Workers;
- publication, accessibility, route, SEO, media, and production-safety validation.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the main system boundaries.

## Local validation

The broad local verification entrypoint is:

```bash
bash scripts/build-and-verify.sh public
```

It performs syntax checks, contract/unit tests, media and routing checks, Hugo module validation, a production-like Hugo build, and rendered-site verification.

Some production workflows additionally depend on configured secrets, Cloudflare/Notion access, or live endpoints and therefore cannot be reproduced by the local build alone.

## Production safety

The repository intentionally separates:

- content synchronization;
- candidate validation;
- production deployment;
- paid/externally visible workflows;
- Worker deployment.

GitHub Actions are checked for pinned action SHAs and workflow safety contracts. Do not bypass these gates simply to make a deployment pass.

## Workers

- `workers/huikai-comments/` — comment submission, moderation/lifecycle, rate limiting, capability-token management, and persistence.
- `workers/notion-media-gateway/` — server-side Notion media resolution and same-site session/media proxy boundary.

Each Worker has local runtime tests beside its implementation.

## Secrets

Never commit Notion tokens, Cloudflare credentials, admin tokens, API keys, or production session secrets. Browser-side code must not receive server/Worker secrets.

## Change discipline

For a material change:

1. identify the affected contract or trust boundary;
2. update/add the corresponding verifier or test;
3. run the relevant local checks;
4. open a pull request and let the repository validation workflows run;
5. keep production mutations/deployments behind their existing explicit gates.

The goal is not to maximize workflow count. A check should exist because it protects a real publishing, security, routing, rights, or reader-facing invariant.
