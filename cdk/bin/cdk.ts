#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticSiteStack } from '../lib/static-site-stack';

const app = new cdk.App();

function numberContext(key: string): number | undefined {
	const value = app.node.tryGetContext(key);
	if (value === undefined) return undefined;
	const number = Number(value);
	if (!Number.isFinite(number)) {
		throw new Error(`CDK context '${key}' must be a finite number.`);
	}
	return number;
}

new StaticSiteStack(app, 'StaticSiteStack', {
	reliabilitySloAvailabilityTarget: numberContext('reliabilitySloAvailabilityTarget'),
	reliabilitySloApiLatencyP95TargetMs: numberContext('reliabilitySloApiLatencyP95TargetMs'),
});