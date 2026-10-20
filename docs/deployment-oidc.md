# AWS deployment

Production site: <https://d2nod46fx08aeg.cloudfront.net/>

The Astro application is built as a static site and deployed to the existing
Amazon S3 bucket behind CloudFront. AWS CDK manages the site and infrastructure.
CloudFront sends `/api/*` requests to an API Gateway HTTP API, which invokes
the weather, feedback, health, or Movies Lambda handler.

## Movies API setup

The static Movies page requests the same-origin `/api/movies` endpoint. The
endpoint calls TMDB from a Lambda function; the browser never receives the
TMDB access token. Before deploying the Movies feature, create an AWS Secrets
Manager secret named `personal-site/tmdb-api-read-access-token` containing the
TMDB API Read Access Token. The Movies Lambda receives permission to read only
that secret. Do not put the token in Astro variables, source files, workflow
variables, query strings, or logs.

Local development may use `TMDB_API_READ_ACCESS_TOKEN` in the developer's
environment. Do not commit a local environment file containing the token.
The CI build validates the generated Movies route, attribution, logo, poster
image origin, and same-origin API path; it does not contact TMDB or verify the
production secret.

TMDB attribution is displayed on the Movies page using the approved logo and
required disclaimer. Movie data is not used with AI or chatbot features.
Review TMDB's current API terms before changing how the data is used.

## First successful production deployment

The first successful deployment completed on **20 October 2026**:

- Workflow: [Deploy to AWS, run #29](https://github.com/JamieRuane/cs4421-astro-blog/actions/runs/39410124309)
- Commit on `main`: [`32c3235`](https://github.com/JamieRuane/cs4421-astro-blog/commit/32c323565f51e3277711da6e34d8690cf0332087)
- Result: successful; the workflow ran for about four minutes.
- The site owner also confirmed that the live website works.

The successful workflow completed its build, CSP validation, CDK synthesis,
OIDC authentication, deployment, health checks, and deployed-header checks.
The checks and their limits are recorded below so a successful deployment is
not mistaken for a complete manual regression test.

Earlier deployment attempts failed before the OIDC trust was corrected. The
role trust policy had the wrong owner value in the `sub` condition. GitHub's
subject identifies the owner by its login in the repository subject, for
example:

```text
repo:JamieRuane/cs4421-astro-blog:ref:refs/heads/main
```

The repository ID is a separate OIDC claim; it is not a substitute for the
owner/repository subject string. Correcting the owner value allowed the
successful run to assume the role. Those earlier attempts are historical;
they are not current deployment failures.

## Authentication and prerequisites

GitHub Actions assumes an AWS IAM role through OIDC. It does not store or use
long-lived AWS access keys.

The deployment workflow requires the repository variable
`AWS_DEPLOY_ROLE_ARN`. The role trust must restrict the token audience to
`sts.amazonaws.com` and the subject to this repository's `main` branch:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:JamieRuane/cs4421-astro-blog:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

The AWS account must also have the GitHub OIDC provider configured, and the
role/CDK bootstrap trust must allow only the permissions required to synthesize,
publish assets, and deploy this stack. Keep deployment permissions separate
from Lambda runtime permissions. Do not broaden the trust to arbitrary
branches or repositories.

## Normal deployment process

The workflow in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
runs on pushes to `main` and can also be started with `workflow_dispatch`. It
installs dependencies, builds the static site, validates CSP hashes, checks
that `AWS_DEPLOY_ROLE_ARN` is configured, synthesizes the CDK stack, assumes
the deployment role, deploys the stack, and checks deployed endpoints and
headers.

If a **current** deployment fails, inspect that run's failing step and logs,
the commit it checked out, and the current AWS/role configuration before
acting. Do not blindly rerun an older failed deployment: first establish
whether its commit and infrastructure assumptions are still applicable.
Historical failures before the OIDC correction do not need to be rerun.

## Verification record and follow-up checklist

### Verified by GitHub Actions

- [x] **CI run #95** for commit `32c3235` passed lint, unit tests, the production
  build, CDK synthesis, and CSP validation.
- [x] **Deploy run #29** for commit `32c3235` completed successfully, including
  the build, CSP validation, CDK synthesis, OIDC role assumption, and CDK
  deployment.
- [x] The deployment workflow received the expected status from `/health.json`
  (`healthy`) and `/api/health` (`ok`).
- [x] The workflow checked deployed response headers on `/` and
  `/api/health`: CSP containing `default-src 'self'`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS.
  This confirms those header checks passed on the tested responses; the
  workflow's CSP header check is a presence/prefix check, not a comparison of
  every deployed CSP directive and hash.
- [x] The site owner confirmed that the live website works.

### Still to verify

- [ ] Manually review the homepage and navigation at desktop and mobile sizes.
- [ ] Manually test site-wide search and confirm result navigation.
- [ ] Play Dino Run, Hangman, and Wordle on desktop and mobile.
- [ ] Exercise `/api/weather` against the deployed endpoint and confirm the
  rendered My Place weather experience.
- [ ] Submit valid and invalid feedback through the live form and confirm the
  acknowledgement and error behavior. Do not use real personal information
  for test submissions.
- [ ] Inspect the complete deployed security-header values, including the
  effective CSP directives and hashes, on both static and API responses.
- [ ] Verify API caching behavior with deployed requests/headers; the
  deployment's health check does not test caching.
- [ ] After the Movies feature is deployed, verify popular movies, title
  search, genre/year filters, pagination, and empty/error states at
  `/movies/`; confirm `/api/movies` does not expose the token and that CloudFront
  does not cache API responses.
- [ ] Confirm representative blog routes, My Place, and the other static
  sections in a browser.

The CI and deployment workflows provide build-time and targeted smoke-test
coverage; they do not perform these full browser, weather, feedback, or cache
regression checks. Keep the
[architecture audit and acceptance issue #54](https://github.com/JamieRuane/cs4421-astro-blog/issues/54)
open until the remaining verification is complete.

## Maintenance note

The successful workflow emitted a GitHub Actions warning that
`actions/checkout@v4`, `actions/setup-node@v4`, and
`aws-actions/configure-aws-credentials@v4` target the Node.js 20 action
runtime, which is deprecated and was being forced to Node.js 24 by the runner.
This is a maintenance item for a separate change; no action versions were
changed as part of recording the deployment.
