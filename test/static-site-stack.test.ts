import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { StaticSiteStack } from '../cdk/lib/static-site-stack';

describe('StaticSiteStack', () => {
	it('keeps the static origin and adds throttled API routes with retained logs', () => {
		const app = new cdk.App();
		const stack = new StaticSiteStack(app, 'TestStaticSiteStack', {
			siteAssetPath: 'public',
		});
		const template = Template.fromStack(stack);

		template.resourceCountIs('AWS::S3::Bucket', 1);
		template.resourceCountIs('AWS::CloudFront::Distribution', 1);
		template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
		template.resourceCountIs('AWS::ApiGatewayV2::Route', 5);
		template.resourceCountIs('AWS::Logs::LogGroup', 6);
		template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
		for (const functionName of [
			'personal-site-weather',
			'personal-site-feedback',
			'personal-site-health',
			'personal-site-movies',
			'personal-site-reliability',
		]) {
			template.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: functionName,
				Runtime: 'nodejs22.x',
			});
		}
		template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
			DefaultRouteSettings: {
				ThrottlingBurstLimit: 20,
				ThrottlingRateLimit: 10,
			},
		});
		template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/weather' });
		template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /api/feedback' });
		template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/health' });
		template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/movies' });
		template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
			RouteKey: 'GET /api/reliability',
		});
		const policies = Object.values(template.findResources('AWS::IAM::Policy'));
		const secretPolicy = policies.find((policy) =>
			JSON.stringify(policy).includes('secretsmanager:GetSecretValue'),
		);
		expect(secretPolicy).toBeDefined();
		const policyDocument = secretPolicy?.Properties.PolicyDocument;
		const secretStatement = policyDocument?.Statement.find((statement: {
			Action: string[];
		}) => statement.Action.includes('secretsmanager:GetSecretValue'));
		expect(secretStatement).toBeDefined();
		expect(JSON.stringify(secretStatement?.Resource)).toContain(
			'personal-site/tmdb-api-read-access-token',
		);
		expect(secretStatement?.Resource).not.toBe('*');
		const reliabilityPolicy = policies
			.flatMap((policy) => policy.Properties.PolicyDocument.Statement)
			.find((statement: { Action: string | string[] }) =>
				JSON.stringify(statement.Action).includes('cloudwatch:GetMetricData'),
			);
		expect(reliabilityPolicy).toMatchObject({
			Action: 'cloudwatch:GetMetricData',
			Resource: '*',
		});
		const reliabilityFunction = Object.values(
			template.findResources('AWS::Lambda::Function'),
		).find((resource) =>
			resource.Properties.FunctionName === 'personal-site-reliability',
		);
		expect(reliabilityFunction?.Properties.Environment.Variables).toMatchObject({
			API_ID: { Ref: expect.any(String) },
			API_STAGE: '$default',
			SLO_AVAILABILITY_TARGET: '0.999',
			SLO_API_LATENCY_P95_TARGET_MS: '1000',
		});
		const buckets = template.findResources('AWS::S3::Bucket');
		const bucket = Object.values(buckets)[0];
		expect(bucket.DeletionPolicy).toBe('Delete');
		expect(bucket.UpdateReplacePolicy).toBe('Delete');

		const distribution = template.findResources('AWS::CloudFront::Distribution');
		const distributionConfig = Object.values(distribution)[0].Properties.DistributionConfig;
		expect(distributionConfig.DefaultRootObject).toBe('index.html');
		expect(distributionConfig.DefaultCacheBehavior.TargetOriginId).toBeDefined();
		expect(distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
		expect(distributionConfig.CacheBehaviors).toHaveLength(1);
		expect(distributionConfig.CacheBehaviors[0].PathPattern).toBe('/api/*');
		expect(distributionConfig.CacheBehaviors[0].ViewerProtocolPolicy).toBe('redirect-to-https');
		expect(distributionConfig.CacheBehaviors[0].CachePolicyId).toBe(
			cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
		);
		expect(distributionConfig.CacheBehaviors[0].ResponseHeadersPolicyId).toBeDefined();
		expect(distributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId).toEqual(
			distributionConfig.CacheBehaviors[0].ResponseHeadersPolicyId,
		);
		const responsePolicies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
		const responsePolicy = Object.values(responsePolicies)[0];
		const csp = responsePolicy.Properties.ResponseHeadersPolicyConfig
			.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toContain("'unsafe-inline'");
		expect(csp).not.toContain('*');
	}, 30_000);

	it('supports valid configurable reliability SLO targets', () => {
		const app = new cdk.App();
		const stack = new StaticSiteStack(app, 'ConfiguredReliabilityStack', {
			siteAssetPath: 'public',
			reliabilitySloAvailabilityTarget: 0.995,
			reliabilitySloApiLatencyP95TargetMs: 750,
		});
		const functions = Template.fromStack(stack).findResources('AWS::Lambda::Function');
		const reliabilityFunction = Object.values(functions).find((resource) =>
			resource.Properties.FunctionName === 'personal-site-reliability',
		);
		expect(reliabilityFunction?.Properties.Environment.Variables).toMatchObject({
			SLO_AVAILABILITY_TARGET: '0.995',
			SLO_API_LATENCY_P95_TARGET_MS: '750',
		});
	}, 30_000);

	it('rejects invalid reliability SLO targets', () => {
		const app = new cdk.App();
		expect(() => new StaticSiteStack(app, 'InvalidReliabilityStack', {
			siteAssetPath: 'public',
			reliabilitySloAvailabilityTarget: 1.1,
		})).toThrow('Reliability availability SLO');
	});
});
