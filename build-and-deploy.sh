
#!/bin/bash

# Build and Deploy Script for MCP Server (Bash version)
echo "🚀 Building and Deploying MCP Server to AWS ECS"
echo "============================================="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "Please install Docker from: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Load environment variables from .env file
if [ -f .env ]; then
    echo "📋 Loading environment variables from .env..."
    export $(grep -v '^#' .env | xargs)
else
    echo "⚠️  No .env file found, using system environment variables"
fi

# Set variables
AWS_REGION="us-east-1"
ECR_REPOSITORY="877508449792.dkr.ecr.us-east-1.amazonaws.com/mcp-server-app"
IMAGE_TAG="latest"

echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPOSITORY

if [ $? -ne 0 ]; then
    echo "❌ ECR login failed"
    exit 1
fi

echo "🏗️  Building Docker image..."
sudo docker build -t $ECR_REPOSITORY:$IMAGE_TAG .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "📤 Pushing image to ECR..."
sudo docker push $ECR_REPOSITORY:$IMAGE_TAG

if [ $? -ne 0 ]; then
    echo "❌ Docker push failed"
    exit 1
fi

echo "🔄 Updating ECS service..."
aws ecs update-service --cluster mcp-cluster --service mcp-service --force-new-deployment --region $AWS_REGION

if [ $? -eq 0 ]; then
    echo "✅ Deployment successful!"
    echo ""
    echo "🌐 Your application will be available at:"
    echo "   http://mcp-alb-1023053955.us-east-1.elb.amazonaws.com"
    echo ""
    echo "📊 Monitor deployment status with:"
    echo "   aws ecs describe-services --cluster mcp-cluster --services mcp-service --region $AWS_REGION"
    echo ""
    echo "🔍 Watch the deployment progress:"
    echo "   aws ecs wait services-stable --cluster mcp-cluster --services mcp-service --region $AWS_REGION"
else
    echo "❌ ECS service update failed"
    exit 1
fi