# Week 6: Containerisation (historical exercise)

The container exercise documented here predates the current deployment
architecture. The production site uses static Astro output on S3 and CloudFront,
with API Gateway HTTP API and Lambda for dynamic endpoints. The repository no
longer builds or deploys an Astro Node SSR container.

Do not use the old container workflow for production. See
[ADR-001](./adr/ADR-001-static-to-ssr.md) for the current deployment decision
and [deployment-oidc.md](./deployment-oidc.md) for GitHub Actions identity
prerequisites.
