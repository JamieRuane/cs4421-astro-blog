# ADR-001: Static Site Hosting with a Serverless API

## Status

Accepted and deployed to production on 2026-10-20.

## Context

The website is primarily published content and does not need server rendering
for its pages. It also has dynamic weather, feedback acknowledgement, and
health endpoints. S3 cannot execute Astro's Node server or dynamic API routes.

## Decision

Build Astro pages as static files and deploy them to the existing private S3
bucket behind the existing CloudFront distribution. Generate blog post routes
from the content collection during the build.

Use an API Gateway HTTP API routed through the CloudFront `/api/*` behavior to
three independent Lambda handlers for:

- `GET /api/weather`
- `POST /api/feedback`
- `GET /api/health`

Keep `/health.json` as a static site/CDN health document. The deployment
workflow checks both health routes so it verifies the static and API paths.
CloudFront enforces the response security headers from `security-policy.json`.

The feedback handler validates submissions and returns the existing
acknowledgement; it does not store submissions or log their personal contents.
Provider credentials for future integrations must remain server-side.

## Production deployment

The first successful production deployment completed on 20 October 2026 at
commit [`32c3235`](https://github.com/JamieRuane/cs4421-astro-blog/commit/32c323565f51e3277711da6e34d8690cf0332087)
through [Deploy to AWS run #29](https://github.com/JamieRuane/cs4421-astro-blog/actions/runs/39410124309).
The deployment workflow successfully built and deployed the site, checked
`/health.json` and `/api/health`, and verified its configured security-header
checks on static and API responses. CI run #95 for the same commit also passed
lint, unit tests, production build, CDK synthesis, and CSP validation.

This confirms the initial deployment path, not every page or API behavior.
Manual verification of search, games, weather, feedback, and API caching is
still tracked in the [deployment verification checklist](../deployment-oidc.md).
Keep [architecture audit and acceptance issue #54](https://github.com/JamieRuane/cs4421-astro-blog/issues/54)
open until those remaining checks are complete.

## Consequences

### Positive

- The mostly static site is served efficiently by S3 and CloudFront.
- Dynamic endpoints have a runtime without keeping a server or container alive.
- Existing `/api/*` browser URLs remain same-origin through CloudFront.
- Lambda and API usage is metered, with no provisioned compute requirement.

### Negative

- API Gateway and Lambda add infrastructure and deployment complexity.
- The public API needs conservative throttling, validation, logging hygiene,
  and operational monitoring.
- Static routes must be generated during each build; request-time page rendering
  is no longer available.
