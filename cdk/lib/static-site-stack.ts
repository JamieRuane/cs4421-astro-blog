import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

type SecurityPolicy = {
	headers: {
		'Content-Security-Policy': Record<string, string[]>;
	};
};

export interface StaticSiteStackProps extends cdk.StackProps {
	siteAssetPath?: string;
}

function createSecurityHeadersPolicy(scope: cdk.Stack): cloudfront.ResponseHeadersPolicy {
	const policy = JSON.parse(
		readFileSync(resolve(process.cwd(), 'security-policy.json'), 'utf8'),
	) as SecurityPolicy;
	const contentSecurityPolicy = Object.entries(policy.headers['Content-Security-Policy'])
		.map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
		.join('; ');

	return new cloudfront.ResponseHeadersPolicy(scope, 'SiteSecurityHeadersPolicy', {
		comment: 'Security headers aligned with security-policy.json',
		securityHeadersBehavior: {
			contentSecurityPolicy: { contentSecurityPolicy, override: true },
			contentTypeOptions: { override: true },
			frameOptions: {
				frameOption: cloudfront.HeadersFrameOption.DENY,
				override: true,
			},
			referrerPolicy: {
				referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
				override: true,
			},
			strictTransportSecurity: {
				accessControlMaxAge: cdk.Duration.seconds(31_536_000),
				override: true,
			},
		},
		customHeadersBehavior: {
			customHeaders: [
				{
					header: 'Permissions-Policy',
					value: 'camera=(), geolocation=(), microphone=()',
					override: true,
				},
			],
		},
	});
}

export class StaticSiteStack extends cdk.Stack {
	constructor(scope: cdk.App, id: string, props?: StaticSiteStackProps) {
		const { siteAssetPath, ...stackProps } = props ?? {};
		super(scope, id, {
			...stackProps,
			env: {
				account: process.env.CDK_DEFAULT_ACCOUNT,
				region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
			},
		});

		const apiLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
			retention: logs.RetentionDays.ONE_WEEK,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		const weatherLogGroup = new logs.LogGroup(this, 'WeatherHandlerLogs', {
			logGroupName: '/aws/lambda/personal-site-weather',
			retention: logs.RetentionDays.ONE_WEEK,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		const feedbackLogGroup = new logs.LogGroup(this, 'FeedbackHandlerLogs', {
			logGroupName: '/aws/lambda/personal-site-feedback',
			retention: logs.RetentionDays.ONE_WEEK,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		const healthLogGroup = new logs.LogGroup(this, 'HealthHandlerLogs', {
			logGroupName: '/aws/lambda/personal-site-health',
			retention: logs.RetentionDays.ONE_WEEK,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		const accessLogFormat = apigateway.AccessLogFormat.custom(JSON.stringify({
			requestId: '$context.requestId',
			routeKey: '$context.routeKey',
			status: '$context.status',
			integrationStatus: '$context.integrationStatus',
			responseLatency: '$context.responseLatency',
		}));

		const weatherHandler = new nodejs.NodejsFunction(this, 'WeatherHandler', {
			entry: resolve(process.cwd(), 'backend/handlers/weather.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_22_X,
			functionName: 'personal-site-weather',
			timeout: cdk.Duration.seconds(15),
			memorySize: 256,
			logGroup: weatherLogGroup,
		});
		const feedbackHandler = new nodejs.NodejsFunction(this, 'FeedbackHandler', {
			entry: resolve(process.cwd(), 'backend/handlers/feedback.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_22_X,
			functionName: 'personal-site-feedback',
			timeout: cdk.Duration.seconds(5),
			memorySize: 128,
			logGroup: feedbackLogGroup,
		});
		const healthHandler = new nodejs.NodejsFunction(this, 'HealthHandler', {
			entry: resolve(process.cwd(), 'backend/handlers/health.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_22_X,
			functionName: 'personal-site-health',
			timeout: cdk.Duration.seconds(5),
			memorySize: 128,
			logGroup: healthLogGroup,
		});

		const httpApi = new apigatewayv2.HttpApi(this, 'SiteApi', {
			apiName: 'personal-site-api',
			createDefaultStage: false,
		});
		httpApi.addRoutes({
			path: '/api/weather',
			methods: [apigatewayv2.HttpMethod.GET],
			integration: new integrations.HttpLambdaIntegration('WeatherIntegration', weatherHandler),
		});
		httpApi.addRoutes({
			path: '/api/feedback',
			methods: [apigatewayv2.HttpMethod.POST],
			integration: new integrations.HttpLambdaIntegration('FeedbackIntegration', feedbackHandler),
		});
		httpApi.addRoutes({
			path: '/api/health',
			methods: [apigatewayv2.HttpMethod.GET],
			integration: new integrations.HttpLambdaIntegration('HealthIntegration', healthHandler),
		});
		new apigatewayv2.HttpStage(this, 'ApiStage', {
			httpApi,
			stageName: '$default',
			autoDeploy: true,
			throttle: { rateLimit: 10, burstLimit: 20 },
			accessLogSettings: {
				destination: new apigatewayv2.LogGroupLogDestination(apiLogGroup),
				format: accessLogFormat,
			},
		});

		const siteBucket = new s3.Bucket(this, 'SiteBucket', {
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
		});

		const urlRewriteFunction = new cloudfront.Function(this, 'UrlRewriteFunction', {
			runtime: cloudfront.FunctionRuntime.JS_2_0,
			code: cloudfront.FunctionCode.fromInline(`
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      if (!uri.includes('.')) {
        if (!uri.endsWith('/')) {
          uri += '/';
        }

        uri += 'index.html';
        request.uri = uri;
      }

      return request;
    }
  `),
		});

		const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
		const apiOrigin = new origins.HttpOrigin(apiDomain);
		const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
			comment: 'Forward only API request content headers and query parameters; never forward cookies.',
			headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('content-type', 'accept'),
			queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
			cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
		});
		const securityHeadersPolicy = createSecurityHeadersPolicy(this);

		const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
			defaultBehavior: {
				origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				responseHeadersPolicy: securityHeadersPolicy,
				functionAssociations: [
					{
						function: urlRewriteFunction,
						eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
					},
				],
			},
			additionalBehaviors: {
				'/api/*': {
					origin: apiOrigin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
					cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
					cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
					originRequestPolicy: apiOriginRequestPolicy,
					responseHeadersPolicy: securityHeadersPolicy,
				},
			},
			defaultRootObject: 'index.html',
		});

		new cdk.CfnOutput(this, 'CloudFrontUrl', {
			value: `https://${distribution.distributionDomainName}`,
			description: 'CloudFront distribution URL used for post-deployment health checks',
		});

		new s3deploy.BucketDeployment(this, 'DeploySite', {
			sources: [s3deploy.Source.asset(siteAssetPath ?? './dist')],
			destinationBucket: siteBucket,
			distribution,
			distributionPaths: ['/*'],
		});
	}
}
