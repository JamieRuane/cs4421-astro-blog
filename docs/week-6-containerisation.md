# Week 6: Containerisation and Week 5 SSR runtime

The production site still uses static Astro output on S3 and CloudFront, with
API Gateway HTTP API and Lambda for dynamic endpoints. The current coursework
implementation additionally builds an Astro Node SSR container.

The container runs `node dist/server/entry.mjs`, not a static file server. See
[ADR-001](./adr/ADR-001-transition-to-ssr.md) for the current deployment decision
and [deployment-oidc.md](./deployment-oidc.md) for GitHub Actions identity
prerequisites.
