import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Week 7 deployment policy', () => {
	it('allows only stack description for the Week 7 stack', () => {
		const policy = JSON.parse(readFileSync(
			new URL('../github-week7-cloudformation-policy.json', import.meta.url),
			'utf8',
		)) as {
			Statement: Array<{
				Action: string;
				Resource: string;
				Effect: string;
			}>;
		};

		expect(policy.Statement).toEqual([{
			Sid: 'DescribeWeek7ContainerStack',
			Effect: 'Allow',
			Action: 'cloudformation:DescribeStacks',
			Resource: 'arn:aws:cloudformation:eu-west-1:423741523931:stack/Week7ContainerStack/*',
		}]);
	});
});
