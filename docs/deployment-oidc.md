# GitHub Actions deployment identity

The production deployment workflow assumes an AWS IAM role through GitHub
Actions OIDC. It does not use long-lived AWS access keys.

Before the workflow can deploy, configure the following in AWS and GitHub:

1. Create the GitHub OIDC identity provider for
   `https://token.actions.githubusercontent.com` with audience
   `sts.amazonaws.com`, unless the provider already exists in the account.
2. Create a deployment role and set its trust policy to require both the
   expected audience and this repository's `main` branch subject:

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

3. Add a GitHub Actions repository variable named `AWS_DEPLOY_ROLE_ARN` whose
   value is the role ARN. This identifier is not a secret. The workflow fails
   before deployment if the variable is empty; credential configuration then
   validates that AWS accepts the OIDC subject and role trust.
4. Grant the deployment role only the permissions needed by the existing CDK
   bootstrap roles and this stack's CloudFormation deployment. The CDK
   bootstrap resources must trust this role for deployment and asset publishing.
   Keep runtime permissions separate from deployment permissions; the weather,
   feedback, and health Lambdas do not need AWS API access.
5. Test the trust with a workflow run from `main` before relying on automated
   production deployments. Pull-request jobs do not receive an AWS deployment
   role.

Do not broaden the trust to all branches, all repositories in the organization,
or arbitrary GitHub subjects. Do not store role session credentials or
third-party provider keys in repository files.
