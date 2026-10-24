import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as process from 'node:process';
import { Construct } from 'constructs';

export interface Week7ContainerStackProps extends cdk.StackProps {
    reliabilityApiId: string;
    reliabilityApiStage?: string;
    reliabilitySloAvailabilityTarget?: number;
    reliabilitySloApiLatencyP95TargetMs?: number;
}

export class Week7ContainerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Week7ContainerStackProps) {
        super(scope, id, props);
        const {
            reliabilityApiId,
            reliabilityApiStage = '$default',
            reliabilitySloAvailabilityTarget = 0.999,
            reliabilitySloApiLatencyP95TargetMs = 1_000,
        } = props;
        if (!reliabilityApiId.trim() || !reliabilityApiStage.trim()) {
            throw new Error('Reliability API ID and stage are required for the SSR container.');
        }
        if (
            !Number.isFinite(reliabilitySloAvailabilityTarget) ||
            reliabilitySloAvailabilityTarget <= 0 ||
            reliabilitySloAvailabilityTarget > 1
        ) {
            throw new Error('Reliability availability SLO must be greater than 0 and at most 1.');
        }
        if (
            !Number.isFinite(reliabilitySloApiLatencyP95TargetMs) ||
            reliabilitySloApiLatencyP95TargetMs <= 0 ||
            reliabilitySloApiLatencyP95TargetMs > 120_000
        ) {
            throw new Error('Reliability API p95 latency SLO must be between 0 and 120000 ms.');
        }

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
        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['cloudwatch:GetMetricData'],
            resources: ['*'],
        }));
        const tmdbSecret = secretsmanager.Secret.fromSecretNameV2(
            this,
            'TmdbApiReadAccessToken',
            'personal-site/tmdb-api-read-access-token',
        );
        tmdbSecret.grantRead(taskRole);

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
                taskRole,
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
            environment: {
                AWS_REGION: 'eu-west-1',
                API_ID: reliabilityApiId,
                API_STAGE: reliabilityApiStage,
                SLO_AVAILABILITY_TARGET: String(reliabilitySloAvailabilityTarget),
                SLO_API_LATENCY_P95_TARGET_MS: String(reliabilitySloApiLatencyP95TargetMs),
                TMDB_API_SECRET_ARN: 'personal-site/tmdb-api-read-access-token',
            },
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
            description: 'Allow the load balancer to reach the Week 7 SSR container',
            allowAllOutbound: true,
        });

        const loadBalancerSecurityGroup = new ec2.SecurityGroup(
            this,
            'LoadBalancerSecurityGroup',
            {
                vpc,
                description: 'Allow HTTP traffic to the Week 7 coursework load balancer',
                allowAllOutbound: true,
            },
        );

        securityGroup.addIngressRule(
            loadBalancerSecurityGroup,
            ec2.Port.tcp(8080),
            'Allow the load balancer to reach the SSR container',
        );

        loadBalancerSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(80),
            'Allow HTTP access to the coursework load balancer',
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

        const loadBalancer = new elbv2.ApplicationLoadBalancer(
            this,
            'BlogLoadBalancer',
            {
                vpc,
                internetFacing: true,
                securityGroup: loadBalancerSecurityGroup,
            },
        );
        const listener = loadBalancer.addListener('HttpListener', {
            port: 80,
            open: false,
        });
        listener.addTargets('BlogTarget', {
            port: 8080,
            targets: [service.loadBalancerTarget({
                containerName: 'BlogContainer',
                containerPort: 8080,
            })],
            healthCheck: {
                path: '/api/health',
                healthyHttpCodes: '200',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            },
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

        new cdk.CfnOutput(this, 'LoadBalancerDnsName', {
            value: loadBalancer.loadBalancerDnsName,
        });
    }
}