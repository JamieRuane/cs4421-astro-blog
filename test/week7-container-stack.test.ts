import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { Week7ContainerStack } from '../cdk/lib/week7-container-stack';

function template() {
	const app = new cdk.App();
	return Template.fromStack(new Week7ContainerStack(app, 'TestWeek7ContainerStack', {
		env: { account: '123456789012', region: 'eu-west-1' },
		reliabilityApiId: 'api-test',
	}));
}

describe('Week7ContainerStack', () => {
	it('wires SSR runtime configuration and the Secrets Manager identifier', () => {
		const synthesized = template();
		const definitions = synthesized.findResources('AWS::ECS::TaskDefinition');
		const taskDefinition = Object.values(definitions)[0];
		const container = taskDefinition.Properties.ContainerDefinitions[0];
		const environment = Object.fromEntries(
			container.Environment.map((entry: { Name: string; Value: string }) =>
				[entry.Name, entry.Value],
			),
		);

		expect(environment).toMatchObject({
			AWS_REGION: 'eu-west-1',
			API_ID: 'api-test',
			API_STAGE: '$default',
			SLO_AVAILABILITY_TARGET: '0.999',
			SLO_API_LATENCY_P95_TARGET_MS: '1000',
			TMDB_API_SECRET_ARN: 'personal-site/tmdb-api-read-access-token',
		});
		expect(container.Secrets).toBeUndefined();
		expect(taskDefinition.Properties.TaskRoleArn).toBeDefined();
		expect(taskDefinition.Properties.ExecutionRoleArn).toBeDefined();
		const policies = JSON.stringify(synthesized.findResources('AWS::IAM::Policy'));
		expect(policies).toContain('cloudwatch:GetMetricData');
		expect(policies).toContain('secretsmanager:GetSecretValue');
	});

	it('requires a Reliability API ID', () => {
		const app = new cdk.App();
		expect(() => new Week7ContainerStack(app, 'MissingApiIdStack', {
			env: { account: '123456789012', region: 'eu-west-1' },
			reliabilityApiId: ' ',
		})).toThrow('Reliability API ID and stage are required');
	});
});
