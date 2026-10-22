# Jamie Ruane's personal website

This is my personal website and blog, built with Astro. It brings together my
writing, games, music and movie discovery pages, and My Place.

**Live site:** [d2nod46fx08aeg.cloudfront.net](https://d2nod46fx08aeg.cloudfront.net/)

## How it is deployed

The existing production URL is a static SSG deployment: Astro generates pages
for Amazon S3 and CloudFront, while the dynamic `/api/*` routes use API Gateway
and Lambda. The Week 5 implementation also builds a genuine SSR runtime with
Astro `output: 'server'` and `@astrojs/node` standalone mode. Its Node server
renders pages at request time and is packaged for ECS/Fargate on port 8080.
The SSR stack is reviewable locally and has not been deployed by this change.

AWS CDK manages both definitions. GitHub Actions assumes an AWS IAM role using
OIDC; it does not use long-lived AWS access keys. The static URL remains
<https://d2nod46fx08aeg.cloudfront.net/>. An SSR URL is not claimed until an
approved load balancer deployment exists.

The static `/reliability/` page reads API Gateway and Lambda CloudWatch metrics
through a read-only `/api/reliability` Lambda endpoint. It displays measured
SLIs separately from configurable SLO targets and treats missing telemetry as
unavailable. See the [reliability dashboard guide](./docs/reliability-dashboard.md)
for metric definitions, limitations, endpoint shape, IAM scope, and SLO setup.

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

To verify the standalone SSR server locally:

```sh
npm run build
$env:PORT=8080
node dist/server/entry.mjs
```

In another terminal, safely test the application:

```sh
curl http://127.0.0.1:8080/
curl http://127.0.0.1:8080/api/health
curl -X POST http://127.0.0.1:8080/api/feedback `
  -H "content-type: application/json" `
  -d '{"name":"Test","message":"Local test"}'
```

`/api/health` is the inexpensive liveness/readiness probe: HTTP 200 means the
process is serving requests, while any non-2xx response means traffic should
not be sent to the task. It does not perform an expensive dependency check.
The ECS container and target group both probe this path. Request logs are JSON
on stdout with `timestamp`, `level`, `route`, `method`, `statusCode`, and
`latencyMs`; ECS forwards them to CloudWatch Logs.

Useful checks:

```sh
npm run lint
npm run test:unit
npm run build
npx cdk synth StaticSiteStack --strict
npm run security:validate
```

The default reliability objectives are 99.9% availability and a 1,000 ms API
Gateway p95 latency. Configure production targets with the
`RELIABILITY_SLO_AVAILABILITY_TARGET` and
`RELIABILITY_SLO_API_LATENCY_P95_TARGET_MS` GitHub repository variables, or
pass the corresponding CDK context keys during local synthesis.

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
[ADR-001](./docs/adr/ADR-001-transition-to-ssr.md).

## Defence questions

- **Why is this genuine SSR?** `output: 'server'` and `@astrojs/node` produce
  `dist/server/entry.mjs`; the running Node process renders `/` on request
  rather than serving a prebuilt HTML file.
- **Why retain S3 and Lambda?** They are the working production rollback path;
  the SSR runtime is additive until its infrastructure and behavior are
  approved.
- **What is liveness versus readiness?** The inexpensive `/api/health` probe
  confirms the process can serve HTTP. A future readiness check can add
  dependency state without making liveness expensive.
- **How are secrets protected?** Tokens stay in environment variables or
  Secrets Manager and are never placed in images, response bodies, or logs.
- **How would you roll back?** Keep CloudFront on the static origin and use the
  previous immutable ECR tag for ECS if an SSR rollout is approved and fails.
