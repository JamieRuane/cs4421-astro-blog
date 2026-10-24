# Week 6: Containerisation and Week 5 SSR runtime

The production site still uses static Astro output on S3 and CloudFront, with
API Gateway HTTP API and Lambda for dynamic endpoints. The current coursework
implementation additionally builds an Astro Node SSR container.

The container runs `node dist/server/entry.mjs`, not a static file server. See
[ADR-001](./adr/ADR-001-transition-to-ssr.md) for the current deployment decision
and [deployment-oidc.md](./deployment-oidc.md) for GitHub Actions identity
prerequisites.

The Week 7 ECS task definition supplies the nonsecret Reliability settings
(`API_ID`, `API_STAGE`, and the SLO targets) as container environment variables.
The task definition supplies only the stable identifier
`personal-site/tmdb-api-read-access-token`; the application retrieves the TMDB
token from Secrets Manager at runtime. The token is not stored in source
control or a plaintext task definition. The task role is granted only
`cloudwatch:GetMetricData` and `secretsmanager:GetSecretValue`.
