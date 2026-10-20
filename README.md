# Jamie Ruane's personal website

This is my personal website and blog, built with Astro. It brings together my
writing, games, music and movie discovery pages, and My Place.

**Live site:** [d2nod46fx08aeg.cloudfront.net](https://d2nod46fx08aeg.cloudfront.net/)

## How it is deployed

Astro generates static pages, which are hosted in Amazon S3 and delivered by
CloudFront. AWS CDK manages the infrastructure. The dynamic `/api/*` routes
are served by an API Gateway HTTP API and AWS Lambda. GitHub Actions assumes an
AWS IAM role using OIDC for deployments; the workflow does not use long-lived
AWS access keys.

The first successful production deployment completed on 20 October 2026:
[Deploy to AWS run #29](https://github.com/JamieRuane/cs4421-astro-blog/actions/runs/39410124309),
for commit [`32c3235`](https://github.com/JamieRuane/cs4421-astro-blog/commit/32c323565f51e3277711da6e34d8690cf0332087).
The deployment took about four minutes. See the
[deployment guide](./docs/deployment-oidc.md) for the OIDC setup, deployment
process, and verification checklist.

## Run locally

From the Astro application directory:

```sh
npm ci
npm run dev
```

Useful checks:

```sh
npm run lint
npm run test:unit
npm run build
npx cdk synth StaticSiteStack --strict
npm run security:validate
```

## Project structure

```text
src/
  components/    Shared page components
  content/blog/  Blog posts
  pages/         Static pages and generated routes
backend/         Lambda handlers for dynamic API routes
cdk/             AWS infrastructure
docs/             Deployment and architecture documentation
```

For more detail on the hosting decision, see
[ADR-001](./docs/adr/ADR-001-static-to-ssr.md).
