import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as process from 'node:process';
import { Construct } from 'constructs';

export class Week7ContainerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const repository = ecr.Repository.fromRepositoryName(
            this,
            'ExistingBlogRepository',
            'my-astro-blog',
        );

        const vpc = new ec2.Vpc(this, 'Week7Vpc', {
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
            ],
        });

        const cluster = new ecs.Cluster(this, 'Week7Cluster', {
            vpc,
            clusterName: 'week7-container-cluster',
        });

        const executionRole = new iam.Role(this, 'TaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    'service-role/AmazonECSTaskExecutionRolePolicy',
                ),
            ],
        });

        const logGroup = new logs.LogGroup(this, 'ContainerLogs', {
            logGroupName: '/ecs/week7-container-blog',
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const taskDefinition = new ecs.FargateTaskDefinition(
            this,
            'BlogTaskDefinition',
            {
                cpu: 256,
                memoryLimitMiB: 512,
                executionRole,
            },
        );

        taskDefinition.addContainer('BlogContainer', {
            image: ecs.ContainerImage.fromEcrRepository(
                repository,
                process.env.CONTAINER_IMAGE_TAG ?? 'week7-v1',
            ),
            logging: ecs.LogDrivers.awsLogs({
                logGroup,
                streamPrefix: 'blog',
            }),
            portMappings: [{ containerPort: 8080 }],
            healthCheck: {
                command: [
                    'CMD-SHELL',
                    "node -e \"fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
                ],
                interval: cdk.Duration.seconds(15),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
                startPeriod: cdk.Duration.seconds(20),
            },
        });

        const securityGroup = new ec2.SecurityGroup(this, 'BlogSecurityGroup', {
            vpc,
            description: 'Allow HTTP traffic to the Week 7 coursework container',
            allowAllOutbound: true,
        });

        securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(8080),
            'Allow access to coursework demo on port 8080',
        );

        const service = new ecs.FargateService(this, 'BlogService', {
            cluster,
            serviceName: 'week7-container-blog',
            taskDefinition,
            desiredCount: 1,
            assignPublicIp: true,
            securityGroups: [securityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            circuitBreaker: { rollback: true },
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
            healthCheckGracePeriod: cdk.Duration.seconds(30),
        });

        new cdk.CfnOutput(this, 'ClusterName', {
            value: cluster.clusterName,
        });

        new cdk.CfnOutput(this, 'ServiceName', {
            value: service.serviceName,
        });

        new cdk.CfnOutput(this, 'LogGroupName', {
            value: logGroup.logGroupName,
        });

        new cdk.CfnOutput(this, 'RepositoryUri', {
            value: repository.repositoryUri,
        });
    }
}