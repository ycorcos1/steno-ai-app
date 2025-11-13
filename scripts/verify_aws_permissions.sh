#!/bin/bash
# Verify AWS permissions for StenoAI deployment

set -e

echo "🔍 Verifying AWS CLI Configuration..."
echo "======================================"

# Check AWS CLI is configured
echo -n "AWS CLI configured: "
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ YES"
    aws sts get-caller-identity --output json | jq -r '"Account: \(.Account) | User: \(.Arn)"'
else
    echo "❌ NO"
    exit 1
fi

echo ""
echo "🔐 Testing Service Permissions..."
echo "================================="

# Test S3
echo -n "S3 Access: "
if aws s3 ls > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test CloudFront
echo -n "CloudFront Access: "
if aws cloudfront list-distributions --max-items 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test API Gateway
echo -n "API Gateway Access: "
if aws apigateway get-rest-apis --max-items 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test Lambda (may take time to propagate)
echo -n "Lambda Access: "
if aws lambda list-functions --max-items 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "⚠️  PENDING (may need a few more minutes for IAM propagation)"
fi

# Test Bedrock
echo -n "Bedrock Access: "
if aws bedrock get-foundation-model --region us-east-1 --model-identifier anthropic.claude-3-5-sonnet-20240620-v1:0 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test RDS
echo -n "RDS Access: "
if aws rds describe-db-instances --max-items 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test EC2 (for VPC)
echo -n "EC2/VPC Access: "
if aws ec2 describe-vpcs --max-items 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

# Test Secrets Manager
echo -n "Secrets Manager Access: "
if aws secretsmanager list-secrets --max-results 1 > /dev/null 2>&1; then
    echo "✅ YES"
else
    echo "❌ NO"
fi

echo ""
echo "✅ Permission verification complete!"
echo ""
echo "Note: If Lambda shows PENDING, wait 2-5 minutes and run this script again."
echo "IAM policy changes can take a few minutes to fully propagate."

