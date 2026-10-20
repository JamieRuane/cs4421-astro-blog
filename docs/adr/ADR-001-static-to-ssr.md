# ADR-001: Static Site Hosting with a Serverless API

## Status

Accepted on 2026-10-20.

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
