# Docker Build and Deploy Script for MCP Server
Write-Host "🚀 Building and Deploying MCP Server to AWS ECS" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Check if Docker is available
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Load environment variables
Write-Host "📋 Loading environment variables..." -ForegroundColor Yellow
if (-not (Test-Path .env)) {
    Write-Host "❌ .env file not found" -ForegroundColor Red
    exit 1
}

$envContent = Get-Content .env
foreach ($line in $envContent) { 
    if ($line -match '^([^=]+)=(.*)$') { 
        $name = $matches[1]
        $value = $matches[2]
        Set-Item -Path "env:$name" -Value $value
    } 
}

# Set variables with environment variable overrides
$AWS_REGION = $env:AWS_REGION ?? "us-east-1"
$AWS_ACCOUNT_ID = $env:AWS_ACCOUNT_ID ?? "877508449792"
$ECR_REPOSITORY = "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mcp-server-app"
$IMAGE_TAG = $env:IMAGE_TAG ?? "latest"

Write-Host "🔐 Logging into ECR..." -ForegroundColor Yellow
$loginResult = aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPOSITORY

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ECR login failed" -ForegroundColor Red
    exit 1
}

Write-Host "🏗️  Building Docker image..." -ForegroundColor Yellow
docker build -t $ECR_REPOSITORY`:$IMAGE_TAG .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host "📤 Pushing image to ECR..." -ForegroundColor Yellow
docker push $ECR_REPOSITORY`:$IMAGE_TAG

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker push failed" -ForegroundColor Red
    exit 1
}

Write-Host "🔄 Updating ECS service..." -ForegroundColor Yellow
aws ecs update-service --cluster mcp-cluster --service mcp-service --force-new-deployment --region $AWS_REGION

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Getting load balancer URL..." -ForegroundColor Cyan
    $loadBalancerDns = aws elbv2 describe-load-balancers --names mcp-alb --query 'LoadBalancers[0].DNSName' --output text --region $AWS_REGION 2>$null
    if ($loadBalancerDns -and $loadBalancerDns -ne "None") {
        Write-Host "   http://$loadBalancerDns" -ForegroundColor White
    } else {
        Write-Host "   Load balancer URL not found" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "📊 Monitor deployment status with:" -ForegroundColor Yellow
    Write-Host "   aws ecs describe-services --cluster mcp-cluster --services mcp-service --region $AWS_REGION" -ForegroundColor White
} else {
    Write-Host "❌ ECS service update failed" -ForegroundColor Red
    exit 1
}