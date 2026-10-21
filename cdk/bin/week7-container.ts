#!/usr/bin / env node
import * as cdk from 'aws-cdk-lib';
import { Week7ContainerStack } from '../lib/week7-container-stack';

const app = new cdk.App();

new Week7ContainerStack(app, 'Week7ContainerStack', {
    env: {
        account: '423741523931',
        region: 'eu-west-1',
    },
});
