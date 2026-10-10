# Week 6: Containerisation

The existing Astro configuration already selects server output and the
`@astrojs/node` standalone adapter, so the Dockerfile builds that production
server without changing the application configuration or AWS workflow.

The AWS workflow still builds the app and uploads `./dist` to S3. Server output
includes both the client files and Node server, while S3 cannot execute the
server. The project also has explicitly server-rendered weather and feedback
API routes. This lab leaves that deployment untouched; verify its current
compatibility before deploying changes to AWS.

## Build and run locally

Run these commands from the Astro project root:

```powershell
docker build --platform linux/amd64 -t astro-blog:v1.0.0 .
docker run --name astro-blog -d -p 4321:4321 astro-blog:v1.0.0
```

Check the site and health endpoint:

```powershell
Invoke-WebRequest http://localhost:4321
Invoke-RestMethod http://localhost:4321/api/health
```

Inspect the running container, logs, and health status. The health status can
initially be `starting`; repeat the inspect command until it becomes `healthy`.
Docker continues probing so the status can recover after a transient failure.

```powershell
docker ps
docker logs astro-blog
docker inspect --format '{{json .State.Health}}' astro-blog
```

After testing, stop and remove the local container:

```powershell
docker stop astro-blog
docker rm astro-blog
```

## Push to Amazon ECR

The following commands are for a deliberate, approved push only. They create an
ECR repository and push the local image; do not run them until AWS changes are
approved. Replace `<AWS_ACCOUNT_ID>` with the account ID for the target account.

```powershell
$accountId = "<AWS_ACCOUNT_ID>"
$repositoryUri = "$accountId.dkr.ecr.eu-west-1.amazonaws.com/astro-blog"

aws ecr create-repository --repository-name astro-blog --region eu-west-1
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "$accountId.dkr.ecr.eu-west-1.amazonaws.com"
docker tag astro-blog:v1.0.0 "${repositoryUri}:v1.0.0"
docker push "${repositoryUri}:v1.0.0"
```
