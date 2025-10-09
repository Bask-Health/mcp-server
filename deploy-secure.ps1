# Secure Deployment Script for MCP Server (PowerShell)
# This script shows how to properly set secrets before deployment

Write-Host "🔐 MCP Server Secure Deployment" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Function to check environment variables
function Test-EnvVar {
    param([string]$VarName)
    
    $value = [Environment]::GetEnvironmentVariable($VarName)
    if ([string]::IsNullOrEmpty($value)) {
        Write-Host "❌ Error: $VarName environment variable is not set" -ForegroundColor Red
        Write-Host "   Please set it with: `$env:$VarName='your-value'" -ForegroundColor Yellow
        return $false
    } else {
        Write-Host "✅ $VarName is set" -ForegroundColor Green
        return $true
    }
}

Write-Host "📋 Checking required environment variables..." -ForegroundColor Yellow

# Check required variables
$allSet = $true
$allSet = (Test-EnvVar "OPENAI_API_KEY") -and $allSet
$allSet = (Test-EnvVar "API_KEY") -and $allSet
$allSet = (Test-EnvVar "DB_PASSWORD") -and $allSet

# Optional variables with warnings
if ([string]::IsNullOrEmpty($env:VECTOR_STORE_ID)) {
    Write-Host "⚠️  Warning: VECTOR_STORE_ID is not set" -ForegroundColor Yellow
}

if ([string]::IsNullOrEmpty($env:GITHUB_TOKEN)) {
    Write-Host "⚠️  Warning: GITHUB_TOKEN is not set (GitHub integration will be disabled)" -ForegroundColor Yellow
}

if (-not $allSet) {
    Write-Host ""
    Write-Host "Please set the missing environment variables and try again." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🚀 Starting deployment..." -ForegroundColor Cyan

# Set stage if not already set
if ([string]::IsNullOrEmpty($env:SST_STAGE)) {
    $env:SST_STAGE = "dev"
}

# Deploy the infrastructure
$deployResult = npx sst deploy --stage $env:SST_STAGE

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Infrastructure deployed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Next steps:" -ForegroundColor Cyan
    Write-Host "1. Update the secrets in AWS Secrets Manager with your actual values"
    Write-Host "2. Build and push your Docker image to ECR"
    Write-Host "3. Update the ECS service to use the new image"
    Write-Host ""
    Write-Host "🔒 Security reminders:" -ForegroundColor Yellow
    Write-Host "- Never commit .env files to version control"
    Write-Host "- Rotate secrets regularly"
    Write-Host "- Use least-privilege IAM policies"
    Write-Host "- Enable CloudTrail for audit logging"
} else {
    Write-Host "❌ Deployment failed. Check the logs above." -ForegroundColor Red
    exit 1
}