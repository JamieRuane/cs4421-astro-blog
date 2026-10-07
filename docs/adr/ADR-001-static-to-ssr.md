# ADR-001: Transition from Static Site to Containerized SSR Runtime

## Status

Accepted

Date: 2026-10-05

## Context

Our blog currently uses Astro's static site generation.

Static hosting on Amazon S3 and CloudFront works well for serving
pre-generated HTML, but it cannot execute server-side Node.js code.

Our application now requires dynamic API endpoints such as:

- `/api/health`
- `/api/feedback`

These endpoints require server-side execution.

Therefore, the current static architecture is no longer sufficient
for the requirements of the application.

## Decision

We will migrate the Astro application from static site generation
to server-side rendering (SSR).

Astro will use the `@astrojs/node` adapter in standalone mode.

The application will then be packaged and deployed as a Docker
container.

The new architecture will allow Astro to execute server-side
JavaScript and provide dynamic API routes.

## Consequences

### Positive

- Enables server-side API routes.
- Enables dynamic rendering.
- Allows `/api/health` and `/api/feedback` endpoints.
- Provides better support for operational health checks.
- Provides a foundation for future dynamic functionality.

### Negative

- The application is more operationally complex.
- A Node.js runtime is now required.
- The application must run inside a container.
- Container infrastructure introduces additional deployment and
  maintenance requirements.