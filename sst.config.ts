/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "mcp-server",
      removal: input?.stage === "production" ? "retain-all" : "remove",
      protect: ["production", "prod"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
          profile: process.env.AWS_PROFILE || "default",
        },
      },
    };
  },
  async run() {
    const { SHARED_VPC_ID } = await import("./src/stage.js");
    // Create VPC with protection
    const vpc = new aws.ec2.Vpc(
      "McpVpc",
      {
        cidrBlock: "10.0.0.0/16",
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: { Name: "mcp-vpc" },
      },
      { id: SHARED_VPC_ID, protect: $app.stage === "production" }
    );

    const igw = new aws.ec2.InternetGateway(
      "McpIgw",
      {
        vpcId: vpc.id,
        tags: { Name: "mcp-igw" },
      },
      { protect: $app.stage === "production" }
    );

    // Create public subnets for load balancer
    const publicSubnet1 = new aws.ec2.Subnet(
      "PublicSubnet1",
      {
        vpcId: vpc.id,
        cidrBlock: "10.0.1.0/24",
        availabilityZone: "us-east-1a",
        mapPublicIpOnLaunch: true,
        tags: { Name: "mcp-public-1" },
      },
      { protect: $app.stage === "production" }
    );

    const publicSubnet2 = new aws.ec2.Subnet(
      "PublicSubnet2",
      {
        vpcId: vpc.id,
        cidrBlock: "10.0.2.0/24",
        availabilityZone: "us-east-1b",
        mapPublicIpOnLaunch: true,
        tags: { Name: "mcp-public-2" },
      },
      { protect: $app.stage === "production" }
    );

    // Create route tables
    const publicRouteTable = new aws.ec2.RouteTable("PublicRouteTable", {
      vpcId: vpc.id,
      tags: { Name: "mcp-public-rt" },
    });

    // Route for public subnets to internet gateway
    new aws.ec2.Route(
      "PublicRoute",
      {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
      },
      { protect: $app.stage === "production" }
    );

    // Associate public subnets with public route table
    new aws.ec2.RouteTableAssociation(
      "PublicSubnet1Association",
      {
        subnetId: publicSubnet1.id,
        routeTableId: publicRouteTable.id,
      },
      { protect: $app.stage === "production" }
    );

    new aws.ec2.RouteTableAssociation(
      "PublicSubnet2Association",
      {
        subnetId: publicSubnet2.id,
        routeTableId: publicRouteTable.id,
      },
      { protect: $app.stage === "production" }
    );

    // Create ECS cluster with protection
    const cluster = new aws.ecs.Cluster(
      "McpCluster",
      {
        name: "mcp-cluster",
      },
      { protect: $app.stage === "production" }
    );

    // Create security group for the Express service
    const serviceSecurityGroup = new aws.ec2.SecurityGroup(
      "ServiceSecurityGroup",
      {
        vpcId: vpc.id,
        description: "Security group for MCP Express service",
        ingress: [
          {
            fromPort: 8000,
            toPort: 8000,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"], // Public access to Express server
          },
          {
            fromPort: 80,
            toPort: 80,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"], // HTTP access
          },
          {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"], // HTTPS access
          },
        ],
        egress: [
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
          },
        ],
        tags: { Name: "mcp-service-sg" },
      },
      { protect: $app.stage === "production" }
    );

    // Create Application Load Balancer with protection
    const alb = new aws.lb.LoadBalancer(
      "McpLoadBalancer",
      {
        name: "mcp-alb",
        loadBalancerType: "application",
        securityGroups: [serviceSecurityGroup.id],
        subnets: [publicSubnet1.id, publicSubnet2.id],
        enableDeletionProtection: $app.stage === "production",
        tags: { Name: "mcp-alb" },
      },
      { protect: $app.stage === "production" }
    );

    // Create target group for the Express service
    const targetGroup = new aws.lb.TargetGroup(
      "McpTargetGroup2",
      {
        name: "mcp-tg-v2",
        port: 8000,
        protocol: "HTTP",
        vpcId: vpc.id,
        targetType: "ip",
        healthCheck: {
          enabled: true,
          path: "/health",
          port: "8000",
          protocol: "HTTP",
          healthyThreshold: 2,
          unhealthyThreshold: 2,
          timeout: 5,
          interval: 30,
        },
        tags: { Name: "mcp-target-group-v2" },
      },
      {
        replaceOnChanges: ["port", "name"],
      }
    );

    // Create ACM certificate if domain is provided
    const certificate = aws.acm.Certificate.get(
      "arn:aws:acm:us-east-1:877508449792:certificate/7726189f-4e75-4105-b09d-ddf675cc39e5",
      "arn:aws:acm:us-east-1:877508449792:certificate/7726189f-4e75-4105-b09d-ddf675cc39e5"
    );

    // HTTPS listener
    const httpsListener = new aws.lb.Listener("McpHttpsListener", {
      loadBalancerArn: alb.arn,
      port: 443,
      protocol: "HTTPS",
      certificateArn: certificate.arn,
      sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      defaultActions: [
        {
          type: "forward",
          targetGroupArn: targetGroup.arn,
        },
      ],
    });

    // Create ECS task definition
    const taskRole = new aws.iam.Role("McpTaskRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });

    const executionRole = new aws.iam.Role("McpExecutionRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });

    // Attach the required execution role policy
    new aws.iam.RolePolicyAttachment("McpExecutionRolePolicy", {
      role: executionRole.name,
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // Create AWS Secrets Manager secret for sensitive data
    const mcpSecret = new aws.secretsmanager.Secret("McpSecret", {
      name: `mcp-secrets-${$app.stage}2`,
      description: "MCP Server secrets",
    });

    // Add policy to task role for basic access
    new aws.iam.RolePolicyAttachment("McpTaskBasicPolicy", {
      role: taskRole.name,
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // ECS task definition
    const taskDefinition = new aws.ecs.TaskDefinition("McpTaskDefinition", {
      family: "mcp-task",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "512",
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name: "mcp-container",
          image:
            "877508449792.dkr.ecr.us-east-1.amazonaws.com/mcp-server-app:latest",
          essential: true,
          portMappings: [
            {
              containerPort: 8000,
              protocol: "tcp",
            },
          ],
          environment: [
            {
              name: "NODE_ENV",
              value: $app.stage === "production" ? "production" : "development",
            },
            {
              name: "PORT",
              value: "8000",
            },
            {
              name: "LOG_LEVEL",
              value: "info",
            },
            {
              name: "CORS_ORIGIN",
              value: "*",
            },
            {
              name: "REPO_FULL_NAME",
              value: "Bask-Health/docs-v2",
            },
            {
              name: "VERCEL",
              value: "0",
            },
            {
              name: "SESSION_EXPIRY_MINUTES",
              value: "360",
            },
            {
              name: "AWS_REGION",
              value: "us-east-1",
            },
            {
              name: "SST_STAGE",
              value: $app.stage,
            },
            {
              name: "API_KEY",
              value: process.env.API_KEY || "",
            },
            {
              name: "OPENAI_API_KEY",
              value: process.env.OPENAI_API_KEY || "",
            },
            {
              name: "VECTOR_STORE_ID",
              value: process.env.VECTOR_STORE_ID || "",
            },
            {
              name: "GITHUB_WEBHOOK_SECRET",
              value: process.env.GITHUB_WEBHOOK_SECRET || "",
            },
            {
              name: "GITHUB_TOKEN",
              value: process.env.GITHUB_TOKEN || "",
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": "/ecs/mcp-task",
              "awslogs-region": "us-east-1",
              "awslogs-stream-prefix": "ecs",
            },
          },
          healthCheck: {
            command: [
              "CMD-SHELL",
              "curl -f http://localhost:8000/health || exit 1",
            ],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 60,
          },
        },
      ]),
    });

    // CloudWatch log group
    const logGroup = new aws.cloudwatch.LogGroup("McpLogGroup", {
      name: "/ecs/mcp-task",
      retentionInDays: $app.stage === "production" ? 7 : 3, // Shorter retention for dev to save cost
    });

    // ECS service
    const service = new aws.ecs.Service(
      "McpService",
      {
        name: "mcp-service",
        cluster: cluster.id,
        taskDefinition: taskDefinition.arn,
        desiredCount: $app.stage === "production" ? 2 : 1, // Scale down for dev
        launchType: "FARGATE",
        networkConfiguration: {
          subnets: [publicSubnet1.id, publicSubnet2.id], // Use public subnets for internet access
          securityGroups: [serviceSecurityGroup.id],
          assignPublicIp: true, // Needed for Fargate tasks to pull images from ECR
        },
        loadBalancers: [
          {
            targetGroupArn: targetGroup.arn,
            containerName: "mcp-container",
            containerPort: 8000,
          },
        ],
      },
      {
        dependsOn: [httpsListener],
      }
    );

    return {
      vpc: {
        id: vpc.id,
        cidrBlock: vpc.cidrBlock,
      },
      service: {
        loadBalancerUrl: $interpolate`https://${alb.dnsName}`,
        clusterName: cluster.name,
        serviceName: service.name,
      },
      subnets: {
        public: [publicSubnet1.id, publicSubnet2.id],
      },
      urls: {
        EXPRESS_SERVER_URL: $interpolate`https://${process.env.DOMAIN_NAME}`,
        HTTPS_URL: $interpolate`https://${process.env.DOMAIN_NAME}`,
      },
      ssl: {
        enabled: true,
        certificateArn: certificate.arn,
      },
    };
  },
});
