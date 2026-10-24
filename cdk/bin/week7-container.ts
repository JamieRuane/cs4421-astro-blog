#!/usr/bin / env node
import * as cdk from 'aws-cdk-lib';
import { Week7ContainerStack } from '../lib/week7-container-stack';

const app = new cdk.App();

new Week7ContainerStack(app, 'Week7ContainerStack', {
    env: {
        account: '423741523931',
        region: 'eu-west-1',
    },
    reliabilityApiId: process.env.RELIABILITY_API_ID ?? '',
    reliabilityApiStage: process.env.RELIABILITY_API_STAGE ?? '$default',
    reliabilitySloAvailabilityTarget: Number(
        process.env.RELIABILITY_SLO_AVAILABILITY_TARGET ?? '0.999',
    ),
    reliabilitySloApiLatencyP95TargetMs: Number(
        process.env.RELIABILITY_SLO_API_LATENCY_P95_TARGET_MS ?? '1000',
    ),
});
