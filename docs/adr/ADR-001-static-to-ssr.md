# ADR-001: Transition from Static Site to Containerized SSR Runtime

## Status

Superseded on 2026-10-07 by the static S3 + CloudFront deployment.

Date: 2026-10-05

## Context

The blog is deployed as static files to a private S3 bucket behind
CloudFront. S3 cannot execute Astro's Node server or dynamic API routes.
The weather data is public and requires no secret key, so the browser can
request it directly from Open-Meteo without a server-side endpoint.

## Decision

Use Astro static output and deploy the generated `dist/` files to S3 +
CloudFront. The Weather component calls Open-Meteo directly from the browser;
the CSP connect-src policy allows only `https://api.open-meteo.com` in
addition to the site's own origin. The existing health API is prerendered as
static JSON, and CloudFront rewrites `/api/health` to that file. The deployment
workflow continues to check the separate `/health.json` endpoint.

If future features require private credentials or server-side dynamic
responses, introduce a separate API service such as API Gateway + Lambda
instead of deploying Astro's Node server to S3.

## Consequences

### Positive

- S3 + CloudFront can serve the complete site without a Node runtime.
- Weather remains current through a public browser-to-provider request.
- Both health-check URLs remain available as static JSON.

### Negative

- Browser users request weather directly from Open-Meteo; no server-side
  proxy or secret API key is used.
- Future secret-dependent server APIs will require a separate backend.