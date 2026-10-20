import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { StaticSiteStack } from '../cdk/lib/static-site-stack';

describe('StaticSiteStack', () => {
	it('keeps the static origin and adds three throttled API routes with retained logs', () => {
		const app = new cdk.App();
		const stack = new StaticSiteStack(app, 'TestStaticSiteStack', {
			siteAssetPath: 'public',
		});
		const template = Template.fromStack(stack);

		template.resourceCountIs('AWS::S3::Bucket', 1);
		template.resourceCountIs('AWS::CloudFront::Distribution', 1);
		template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
		template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
		template.resourceCountIs('AWS::Logs::LogGroup', 4);
		template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
		for (const functionName of [
			'personal-site-weather',
			'personal-site-feedback',
			'personal-site-health',
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
		const buckets = template.findResources('AWS::S3::Bucket');
		const bucket = Object.values(buckets)[0];
		expect(bucket.DeletionPolicy).toBe('Delete');
		expect(bucket.UpdateReplacePolicy).toBe('Delete');

		const distribution = template.findResources('AWS::CloudFront::Distribution');
		const distributionConfig = Object.values(distribution)[0].Properties.DistributionConfig;
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
});
