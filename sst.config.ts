/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "mcp-server",
      removal: input?.stage === "production" ? "retain" : "remove",
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
    // Create VPC with protection (will use existing if already deployed)
    const vpc = new aws.ec2.Vpc(
      "McpVpc",
      {
        cidrBlock: "10.0.0.0/16",
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: { Name: "mcp-vpc" },
      },
      { protect: $app.stage === "production" }
    );

    // Create Internet Gateway
    const igw = new aws.ec2.InternetGateway(
      "McpIgw",
      {
        vpcId: vpc.id,
        tags: { Name: "mcp-igw" },
      },
      { protect: $app.stage === "production" }
    );

    // Create public subnets for load balancer
    const publicSubnet1 = new aws.ec2.Subnet("PublicSubnet1", {
      vpcId: vpc.id,
      cidrBlock: "10.0.1.0/24",
      availabilityZone: "us-east-1a",
      mapPublicIpOnLaunch: true,
      tags: { Name: "mcp-public-1" },
    });

    const publicSubnet2 = new aws.ec2.Subnet("PublicSubnet2", {
      vpcId: vpc.id,
      cidrBlock: "10.0.2.0/24",
      availabilityZone: "us-east-1b",
      mapPublicIpOnLaunch: true,
      tags: { Name: "mcp-public-2" },
    });

    // Create private subnets for containers
    // const privateSubnet1 = new aws.ec2.Subnet("PrivateSubnet1", {
    //   vpcId: vpc.id,
    //   cidrBlock: "10.0.10.0/24",
    //   availabilityZone: "us-east-1a",
    //   tags: { Name: "mcp-private-1" },
    // });

    // const privateSubnet2 = new aws.ec2.Subnet("PrivateSubnet2", {
    //   vpcId: vpc.id,
    //   cidrBlock: "10.0.11.0/24",
    //   availabilityZone: "us-east-1b",
    //   tags: { Name: "mcp-private-2" },
    // });

    // Create database subnets
    const dbSubnet1 = new aws.ec2.Subnet("DbSubnet1", {
      vpcId: vpc.id,
      cidrBlock: "10.0.20.0/24",
      availabilityZone: "us-east-1a",
      tags: { Name: "mcp-db-1" },
    });

    const dbSubnet2 = new aws.ec2.Subnet("DbSubnet2", {
      vpcId: vpc.id,
      cidrBlock: "10.0.21.0/24",
      availabilityZone: "us-east-1b",
      tags: { Name: "mcp-db-2" },
    });

    // Create route tables
    const publicRouteTable = new aws.ec2.RouteTable("PublicRouteTable", {
      vpcId: vpc.id,
      tags: { Name: "mcp-public-rt" },
    });

    // Route for public subnets to internet gateway
    new aws.ec2.Route("PublicRoute", {
      routeTableId: publicRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    });

    // Associate public subnets with public route table
    new aws.ec2.RouteTableAssociation("PublicSubnet1Association", {
      subnetId: publicSubnet1.id,
      routeTableId: publicRouteTable.id,
    });

    new aws.ec2.RouteTableAssociation("PublicSubnet2Association", {
      subnetId: publicSubnet2.id,
      routeTableId: publicRouteTable.id,
    });

    // Create DB subnet group (using public subnets for initial setup and testing)
    const dbSubnetGroup = new aws.rds.SubnetGroup("DbSubnetGroup", {
      name: "mcp-db-subnet-group",
      subnetIds: [publicSubnet1.id, publicSubnet2.id], // Using public subnets for setup
      tags: { Name: "mcp-db-subnet-group" },
    });

    // Create security group for database
    const dbSecurityGroup = new aws.ec2.SecurityGroup("DbSecurityGroup", {
      vpcId: vpc.id,
      description: "Security group for MCP database",
      ingress: [
        {
          fromPort: 3306,
          toPort: 3306,
          protocol: "tcp",
          cidrBlocks: ["10.0.0.0/16"], // VPC access
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
      tags: { Name: "mcp-db-sg" },
    });

    // Generate a secure random password for the database
    const dbPassword = new aws.secretsmanager.Secret("DbPasswordSecret", {
      name: `mcp-db-password-${$app.stage}`,
      description: "MCP Database password",
    });

    const dbPasswordVersion = new aws.secretsmanager.SecretVersion(
      "DbPasswordVersion",
      {
        secretId: dbPassword.id,
        secretString: process.env.DB_PASSWORD || "tempPassword123!ChangeMe",
      }
    );

    // Create RDS database instance
    const database = new aws.rds.Instance("McpDatabase", {
      identifier: "mcp-database", 
      engine: "mysql",
      engineVersion: "8.0",
      instanceClass: "db.t3.micro", // Free tier eligible
      allocatedStorage: 20,
      storageType: "gp2",
      dbName: "mcp_sessions",
      username: "mcpuser",
      password: process.env.DB_PASSWORD,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      dbSubnetGroupName: dbSubnetGroup.name,
      backupRetentionPeriod: $app.stage === "production" ? 7 : 1,
      skipFinalSnapshot: $app.stage !== "production",
      publiclyAccessible: true,
      tags: { Name: "mcp-database" },
    });

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
      }
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

    // Create ALB listener
    const listener = new aws.lb.Listener("McpListener", {
      loadBalancerArn: alb.arn,
      port: 8080,
      protocol: "HTTP",
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
      name: `mcp-secrets-${$app.stage}`,
      description: "MCP Server secrets",
    });

    // Store the secret values (in production, these should be set separately)
    const secretVersion = new aws.secretsmanager.SecretVersion(
      "McpSecretVersion",
      {
        secretId: mcpSecret.id,
        secretString: JSON.stringify({
          API_KEY: process.env.API_KEY || "",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
          VECTOR_STORE_ID: process.env.VECTOR_STORE_ID || "",
          GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || "",
          GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
        }),
      }
    );

    // Add policy to task role for basic access
    new aws.iam.RolePolicyAttachment("McpTaskBasicPolicy", {
      role: taskRole.name,
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    const DATABASE_URL = $interpolate`mysql://${database.username}:${
      process.env.DB_PASSWORD
    }@${database.endpoint}/${database.dbName}`;

    // Create ECS task definition with cost optimizations
    const taskDefinition = new aws.ecs.TaskDefinition("McpTaskDefinition", {
      family: "mcp-task",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256", // Minimum CPU for cost optimization
      memory: "512", // Minimum memory for cost optimization
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
              name: "DATABASE_URL",
              value: DATABASE_URL,
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
            {
              name: "DB_HOST",
              value: database.endpoint,
            },
            {
              name: "DB_PORT",
              value: "3306",
            },
            {
              name: "DB_USER",
              value: database.username,
            },
            {
              name: "DB_NAME",
              value: database.dbName,
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

    // Create CloudWatch log group with cost optimization
    const logGroup = new aws.cloudwatch.LogGroup("McpLogGroup", {
      name: "/ecs/mcp-task",
      retentionInDays: $app.stage === "production" ? 7 : 3, // Shorter retention for dev to save cost
    });

    // Create ECS service with cost optimization
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
      { dependsOn: [listener] }
    );

    // Return outputs
    return {
      vpc: {
        id: vpc.id,
        cidrBlock: vpc.cidrBlock,
      },
      database: {
        endpoint: database.endpoint,
        port: database.port,
        dbName: database.dbName,
        username: database.username,
        publiclyAccessible: database.publiclyAccessible,
      },
      service: {
        loadBalancerUrl: $interpolate`http://${alb.dnsName}`,
        clusterName: cluster.name,
        serviceName: service.name,
      },
      subnets: {
        public: [publicSubnet1.id, publicSubnet2.id],
        // private: [privateSubnet1.id, privateSubnet2.id],
        database: [dbSubnet1.id, dbSubnet2.id],
      },
      urls: {
        DATABASE_URL: DATABASE_URL,
        EXPRESS_SERVER_URL: $interpolate`http://${alb.dnsName}`,
      },
    };
  },
});
