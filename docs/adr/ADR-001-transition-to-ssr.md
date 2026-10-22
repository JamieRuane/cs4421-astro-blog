# ADR-001: Transition from Static Site to Containerized SSR Runtime

## Status

Proposed for local implementation review. No AWS resources have been deployed
or changed as part of this decision.

Decision date: 2026-10-22.

## Context

The existing production site is an Astro static build in S3 behind CloudFront,
with `/api/*` routed to API Gateway and Lambda. Static hosting is efficient
for published content, but it cannot execute Astro server code at request time
or provide a single application runtime for container health and observability.
The existing custom container server also served files from `dist`, so it did
not prove that Astro SSR was running.

## Decision

Use Astro `output: 'server'` with the official `@astrojs/node` adapter in
`standalone` mode. The build produces `dist/server/entry.mjs`, which is run
directly by a non-root Node.js 22 Alpine container on port 8080.

The existing Lambda handlers are reused by Astro API route adapters for the
container (`/api/health`, `/api/feedback`, `/api/weather`, `/api/movies`, and
`/api/reliability`). The existing S3, CloudFront, API Gateway, and Lambda
deployment remains intact; this ADR does not replace or deploy that path.

The reviewable ECS design uses the existing ECR repository and a Fargate
service behind an internet-facing Application Load Balancer. The target group
uses port 8080 and `/api/health`; the task security group accepts port 8080
only from the load balancer. The current stack has no HTTPS listener or custom
domain, so it is suitable for coursework review, not a production cutover.

## Alternatives considered

- **Static SSG:** Retain S3 and CloudFront only. This remains the production
  rollback path but cannot provide request-time rendering.
- **SSR container:** Selected for a genuine Node runtime and straightforward
  container health, logging, and ECS operations.
- **Serverless functions:** Keep dynamic work in API Gateway and Lambda. This
  remains in use for the static deployment, but does not provide one SSR
  application process.

## Consequences

### Positive

- Request-time rendering is performed by Astro's Node server.
- The container has explicit liveness/readiness-compatible health behavior.
- JSON request logs are emitted to stdout for ECS and CloudWatch collection.
- Existing API validation and secret-handling code is reused.

### Negative and operational cost

- ECS, ECR, a load balancer, task networking, and log retention cost more than
  S3/CloudFront alone and require operational maintenance.
- The SSR task must remain available, and upstream APIs can affect responses.
- A production deployment would need HTTPS, a domain, tighter ingress, and
  runtime IAM permissions for any AWS-backed route such as Movies or
  Reliability.
- No persistence is introduced for feedback; the endpoint acknowledges receipt
  without claiming durable storage.

### Security and observability

The image runs as the `node` user, excludes environment files, and does not
log request bodies, cookies, authorization headers, or tokens. The middleware
logs timestamp, level, route, method, status code, latency, and an error type
for unexpected failures. ECS forwards stdout/stderr to CloudWatch.

### Rollback

Do not change the existing CloudFront origin or API routes during review. A
failed SSR rollout can therefore be rolled back by keeping traffic on the
static CloudFront URL and deploying the previous ECS image tag if an ECS
cutover is later approved.

### Existing APIs

The API Gateway/Lambda endpoints remain the source of truth for the static
deployment. The container adapters preserve the same handler validation and
response contracts for local and future SSR traffic; they do not duplicate
feedback persistence or expose provider credentials.
