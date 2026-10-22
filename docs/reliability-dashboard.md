# Reliability dashboard

The static `/reliability/` page fetches the same-origin `GET /api/reliability`
endpoint. The endpoint runs as a dedicated Lambda and reads CloudWatch metrics;
the browser receives only summarized measurements and configured objectives.
It does not receive AWS credentials. No SSR or CloudWatch dashboard resources
are created.

## Metric sources and definitions

The API Gateway HTTP API publishes the `AWS/ApiGateway` metrics `Count`,
`4xx`, `5xx`, and `Latency` automatically at API/stage level. This stack uses
the `ApiId` and `$default` `Stage` dimensions. Route-level detailed metrics
are not enabled, so the dashboard does not assume route dimensions or incur
their additional metric charges. API Gateway latency includes the integration
and API Gateway overhead; it is not a browser, CloudFront, or static-site
latency measurement.

The availability SLI is:

```text
1 - (API Gateway 5xx response count / API Gateway request count)
```

The denominator is all API Gateway requests in the selected measurement
window across the API and `$default` stage, including `/api/reliability`.
Route-level metrics are not enabled, so the dashboard endpoint cannot be
excluded from this API-wide SLI. Server-side HTTP 5xx responses are errors;
HTTP 4xx client responses are displayed separately and excluded. Both
CloudWatch series must contain data and the request denominator must be
positive. Missing metrics, zero traffic, and inconsistent totals produce an
unavailable SLI, not a healthy value.

The latency objective compares the latest CloudWatch `Latency` p95 bucket to
a configured millisecond threshold. The p50 and p95 are computed within the
latest one-minute bucket, or five-minute bucket for a 30-day selected window;
they are not percentiles combined across the selected window. The metric
timestamp identifies the bucket. The API Gateway average is weighted by
CloudWatch `SampleCount`.

The 30-day availability error budget uses 720 one-hour buckets ending at the
most recent complete UTC hour. It is calculated only when every bucket has
both request and 5xx datapoints, request count is positive, and error count
does not exceed requests. This deliberately strict coverage rule means an
absent 5xx metric is not interpreted as zero; the budget may remain
unavailable until CloudWatch provides complete telemetry. The allowed errors
are `request count × (1 - availability objective)`. Consumed budget is
`5xx count / allowed errors × 100`; remaining budget is floored at zero.
CloudWatch datapoints can be delayed, so the error-budget window ends at the
last complete hour, not at the instant the page is loaded.

Lambda invocation, error, throttle, and duration metrics are shown separately
for the existing weather, feedback, health, and movies functions. The
reliability metrics Lambda itself is excluded. Lambda metrics do not establish
end-to-end site availability and do not replace the API Gateway availability
SLI.

## Endpoint contract

`GET /api/reliability?hours=24` returns JSON with `schemaVersion: 1`,
`generatedAt`, the selected `window`, configured `objectives`, raw summarized
`metrics`, `slis`, and `errorBudget`. `hours` defaults to 24 and accepts only a
whole number from 1 through 720. Unknown query parameters and invalid values
receive HTTP 400. Metric values use the stable shape
`{ value, timestamp, status, reason? }`; unavailable values have `value` and
`timestamp` set to `null`. CloudWatch failures are logged without returning
AWS exception details. Throttling returns HTTP 503; other CloudWatch failures
return HTTP 502. Error responses use `{ status: "error", error: string }`.
The selected window is aligned to complete CloudWatch buckets and may end
before `generatedAt` by up to 30 minutes. The endpoint is uncached.

The endpoint issues only fixed metric queries for this API and the four
known Lambda function names. It requires `cloudwatch:GetMetricData`; the
CloudWatch API does not support resource-level scoping for this action, so the
policy uses `Resource: "*"` with that single read-only action.

## SLO configuration

The defaults are 99.9% API availability and a 1,000 ms API Gateway p95
latency. Production deployments can override them using GitHub repository
variables:

- `RELIABILITY_SLO_AVAILABILITY_TARGET`: decimal fraction greater than 0 and
  at most 1 (for example, `0.999`).
- `RELIABILITY_SLO_API_LATENCY_P95_TARGET_MS`: milliseconds greater than 0
  and at most 120,000 (for example, `1000`).

For local CDK synthesis, the equivalent CDK context keys are
`reliabilitySloAvailabilityTarget` and
`reliabilitySloApiLatencyP95TargetMs`. Invalid configuration is rejected by
the stack; no AWS deployment is performed by the local tests.

## Local development

The local Vite API plugin routes `GET /api/reliability` to the same handler,
but it does not create or infer the API Gateway ID. Set `API_ID` to the
deployed API ID and `API_STAGE` to `$default` in the environment used to start
`npm run dev`. The SLO variables are optional and default to 0.999 and 1,000
ms. The AWS SDK also needs a normal local AWS credential profile permitted to
call `cloudwatch:GetMetricData` in `eu-west-1`. Do not put AWS credentials in
the site, browser code, or committed files. Without these local prerequisites,
the handler returns HTTP 503 with “Reliability metrics are not configured.”

## Rollout requirements

Deploying the CDK stack creates the reliability Lambda, its one-week log
group, the `GET /api/reliability` route, and its narrowly scoped CloudWatch
read permission. Until that stack version is deployed, the static page's API
request will receive a not-found response. Check that the deployed Lambda role
can call `cloudwatch:GetMetricData` and that the selected API ID/stage has
published metrics in `eu-west-1`. No AWS credentials or metric permissions
belong in Astro/browser configuration.

The feature does not create CloudWatch metric filters or enable detailed
API route metrics. The static site continues to build to S3 and CloudFront.
