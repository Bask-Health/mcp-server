#!/bin/bash

# Secure Deployment Script for MCP Server
# This script shows how to properly set secrets before deployment

echo "🔐 MCP Server Secure Deployment"
echo "================================"

# Check if required environment variables are set
check_env_var() {
    if [ -z "${!1}" ]; then
        echo "❌ Error: $1 environment variable is not set"
        echo "   Please set it with: export $1='your-value'"
        exit 1
    else
        echo "✅ $1 is set"
    fi
}

echo "📋 Checking required environment variables..."

# Check required variables
check_env_var "OPENAI_API_KEY"
check_env_var "API_KEY"
check_env_var "DB_PASSWORD"

# Optional variables with warnings
if [ -z "$VECTOR_STORE_ID" ]; then
    echo "⚠️  Warning: VECTOR_STORE_ID is not set"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "⚠️  Warning: GITHUB_TOKEN is not set (GitHub integration will be disabled)"
fi

echo ""
echo "🚀 Starting deployment..."

# Deploy the infrastructure
npx sst deploy --stage ${SST_STAGE:-dev}

if [ $? -eq 0 ]; then
    echo "✅ Infrastructure deployed successfully!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Update the secrets in AWS Secrets Manager with your actual values"
    echo "2. Build and push your Docker image to ECR"
    echo "3. Update the ECS service to use the new image"
    echo ""
    echo "🔒 Security reminders:"
    echo "- Never commit .env files to version control"
    echo "- Rotate secrets regularly"
    echo "- Use least-privilege IAM policies"
    echo "- Enable CloudTrail for audit logging"
else
    echo "❌ Deployment failed. Check the logs above."
    exit 1
fi