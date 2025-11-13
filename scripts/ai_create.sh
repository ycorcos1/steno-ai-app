#!/bin/bash
# Create Lambda function and API Gateway HTTP API for StenoAI AI service
set -euo pipefail

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed."
    echo "   Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is required but not installed."
    echo "   Install from: https://aws.amazon.com/cli/"
    exit 1
fi

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

FUNCTION_NAME="${APP}-${ENV}-ai"
ROLE_NAME="${APP}-${ENV}-ai-role"
API_NAME="${APP}-${ENV}-ai"
ZIP_FILE="${PROJECT_ROOT}/apps/ai/ai.zip"
REGION="${REGION}"

echo "🚀 Creating AI infrastructure for StenoAI"
echo "=========================================="
echo "Function: $FUNCTION_NAME"
echo "Role: $ROLE_NAME"
echo "API: $API_NAME"
echo "Region: $REGION"
echo ""

# Check if ai.zip exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Error: AI package not found: $ZIP_FILE"
    echo "   Run 'make ai-zip' first to build the package"
    exit 1
fi

# Step 1: Create IAM role if it doesn't exist
echo "🔐 Step 1: Creating/verifying IAM role..."
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo "  ✅ Role exists: $ROLE_NAME"
else
    echo "  Creating new role..."
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "file://${PROJECT_ROOT}/infra/api/iam-role-trust.json" \
        --description "StenoAI AI Lambda execution role" \
        > /dev/null
    echo "  ✅ Role created: $ROLE_NAME"
fi

# Step 2: Attach basic CloudWatch Logs policy
echo ""
echo "📋 Step 2: Attaching CloudWatch Logs policy..."
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name lambda-basic \
    --policy-document "file://${PROJECT_ROOT}/infra/api/lambda-basic-policy.json" \
    > /dev/null
echo "  ✅ Policy attached"

# Step 2b: Attach Bedrock policy
echo ""
echo "📋 Step 2b: Attaching Bedrock policy..."
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name lambda-bedrock-policy \
    --policy-document "file://${PROJECT_ROOT}/infra/api/lambda-bedrock-policy.json" \
    > /dev/null
echo "  ✅ Bedrock policy attached"

# Step 2c: Attach VPC and Secrets Manager policy (if VPC exists)
echo ""
echo "📋 Step 2c: Attaching VPC and Secrets Manager policy..."
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name lambda-vpc-policy \
    --policy-document "file://${PROJECT_ROOT}/infra/api/lambda-vpc-policy.json" \
    > /dev/null
echo "  ✅ VPC policy attached"

# Step 3: Wait for role propagation (IAM eventual consistency)
echo ""
echo "⏳ Step 3: Waiting for IAM role propagation..."
sleep 10
echo "  ✅ Ready"

# Step 4: Get role ARN
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

# Step 4b: Check for VPC configuration
VPC_CONFIG_FILE="/tmp/vpc-output.json"
HAS_VPC_CONFIG=false
if [ -f "$VPC_CONFIG_FILE" ]; then
    VPC_ID=$(jq -r '.VpcId' "$VPC_CONFIG_FILE" 2>/dev/null || echo "")
    SUBNET1_ID=$(jq -r '.Subnet1Id' "$VPC_CONFIG_FILE" 2>/dev/null || echo "")
    SUBNET2_ID=$(jq -r '.Subnet2Id' "$VPC_CONFIG_FILE" 2>/dev/null || echo "")
    SG_LAMBDA_ID=$(jq -r '.SecurityGroupLambdaId' "$VPC_CONFIG_FILE" 2>/dev/null || echo "")
    
    if [ -n "$VPC_ID" ] && [ "$VPC_ID" != "null" ] && [ -n "$SUBNET1_ID" ] && [ "$SUBNET1_ID" != "null" ] && [ -n "$SUBNET2_ID" ] && [ "$SUBNET2_ID" != "null" ] && [ -n "$SG_LAMBDA_ID" ] && [ "$SG_LAMBDA_ID" != "null" ]; then
        HAS_VPC_CONFIG=true
        echo "  ✅ VPC configuration found, will attach Lambda to VPC"
    fi
fi

# Step 5: Create or update Lambda function
echo ""
echo "⚡ Step 4: Creating/updating Lambda function..."
BEDROCK_REGION="${REGION}"
BEDROCK_MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"
ENV_VARS="ENV=$ENV,REGION=$REGION,APP=$APP,BEDROCK_REGION=$BEDROCK_REGION,BEDROCK_MODEL_ID=$BEDROCK_MODEL_ID"

if aws lambda get-function --function-name "$FUNCTION_NAME" &>/dev/null; then
    echo "  Function exists, updating code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$ZIP_FILE" \
        --region "$REGION" \
        > /dev/null
    
    # Wait for update to complete
    echo "  Waiting for update to complete..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
    
    # Update configuration
    if [ "$HAS_VPC_CONFIG" = true ]; then
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --timeout 60 \
            --memory-size 1024 \
            --environment "Variables={$ENV_VARS}" \
            --vpc-config "SubnetIds=$SUBNET1_ID,$SUBNET2_ID,SecurityGroupIds=$SG_LAMBDA_ID" \
            --region "$REGION" \
            > /dev/null
    else
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --timeout 60 \
            --memory-size 1024 \
            --environment "Variables={$ENV_VARS}" \
            --region "$REGION" \
            > /dev/null
    fi
    
    echo "  ✅ Function updated"
else
    if [ "$HAS_VPC_CONFIG" = true ]; then
        aws lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --runtime python3.10 \
            --role "$ROLE_ARN" \
            --handler main.handler \
            --zip-file "fileb://$ZIP_FILE" \
            --timeout 60 \
            --memory-size 1024 \
            --environment "Variables={$ENV_VARS}" \
            --vpc-config "SubnetIds=$SUBNET1_ID,$SUBNET2_ID,SecurityGroupIds=$SG_LAMBDA_ID" \
            --description "StenoAI AI Lambda function (Bedrock)" \
            --region "$REGION" \
            > /dev/null
    else
        aws lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --runtime python3.12 \
            --role "$ROLE_ARN" \
            --handler main.handler \
            --zip-file "fileb://$ZIP_FILE" \
            --timeout 60 \
            --memory-size 1024 \
            --environment "Variables={$ENV_VARS}" \
            --description "StenoAI AI Lambda function (Bedrock)" \
            --region "$REGION" \
            > /dev/null
    fi
    
    # Wait for function to be active
    echo "  Waiting for function to be active..."
    aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
    
    echo "  ✅ Function created"
fi

# Step 6: Get or create API Gateway HTTP API
echo ""
echo "🌐 Step 5: Creating API Gateway HTTP API..."
EXISTING_API=$(aws apigatewayv2 get-apis \
    --query "Items[?Name=='$API_NAME'].ApiId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_API" ] && [ "$EXISTING_API" != "None" ]; then
    API_ID="$EXISTING_API"
    echo "  ✅ API already exists: $API_ID"
else
    API_RESPONSE=$(aws apigatewayv2 create-api \
        --name "$API_NAME" \
        --protocol-type HTTP \
        --cors-configuration "AllowOrigins=*,AllowMethods=GET,POST,OPTIONS,AllowHeaders=*,MaxAge=300" \
        --region "$REGION" \
        --output json)
    
    API_ID=$(echo "$API_RESPONSE" | jq -r '.ApiId')
    echo "  ✅ API created: $API_ID"
fi

# Step 7: Create Lambda integration
echo ""
echo "🔗 Step 6: Creating Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:${REGION}:$(aws sts get-caller-identity --query Account --output text):function:${FUNCTION_NAME}"

# Check if integration already exists
EXISTING_INTEGRATION=$(aws apigatewayv2 get-integrations \
    --api-id "$API_ID" \
    --query "Items[?IntegrationUri=='$LAMBDA_ARN'].IntegrationId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_INTEGRATION" ] && [ "$EXISTING_INTEGRATION" != "None" ]; then
    INTEGRATION_ID="$EXISTING_INTEGRATION"
    echo "  ✅ Integration already exists: $INTEGRATION_ID"
else
    INTEGRATION_RESPONSE=$(aws apigatewayv2 create-integration \
        --api-id "$API_ID" \
        --integration-type AWS_PROXY \
        --integration-method POST \
        --integration-uri "$LAMBDA_ARN" \
        --payload-format-version "2.0" \
        --region "$REGION" \
        --output json)
    
    INTEGRATION_ID=$(echo "$INTEGRATION_RESPONSE" | jq -r '.IntegrationId')
    echo "  ✅ Integration created: $INTEGRATION_ID"
fi

# Step 8: Create route for /health
echo ""
echo "🛣️  Step 7: Creating /health route..."
EXISTING_ROUTE=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --query "Items[?RouteKey=='GET /health'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_ROUTE" ] && [ "$EXISTING_ROUTE" != "None" ]; then
    echo "  ✅ Route already exists, updating..."
    aws apigatewayv2 update-route \
        --api-id "$API_ID" \
        --route-id "$EXISTING_ROUTE" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Route updated"
else
    aws apigatewayv2 create-route \
        --api-id "$API_ID" \
        --route-key "GET /health" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Route created"
fi

# Step 8b: Create route for /generate
echo ""
echo "🛣️  Step 7b: Creating /generate route..."
EXISTING_GENERATE_ROUTE=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --query "Items[?RouteKey=='POST /generate'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_GENERATE_ROUTE" ] && [ "$EXISTING_GENERATE_ROUTE" != "None" ]; then
    echo "  ✅ Route already exists, updating..."
    aws apigatewayv2 update-route \
        --api-id "$API_ID" \
        --route-id "$EXISTING_GENERATE_ROUTE" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Route updated"
else
    aws apigatewayv2 create-route \
        --api-id "$API_ID" \
        --route-key "POST /generate" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Route created"
fi

# Step 8c: Create catch-all route for Mangum
echo ""
echo "🛣️  Step 7c: Creating catch-all route..."
EXISTING_CATCHALL=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --query "Items[?RouteKey=='\$default'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_CATCHALL" ] && [ "$EXISTING_CATCHALL" != "None" ]; then
    echo "  ✅ Catch-all route already exists"
else
    aws apigatewayv2 create-route \
        --api-id "$API_ID" \
        --route-key "\$default" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Catch-all route created"
fi

# Step 9: Grant API Gateway invoke permission
echo ""
echo "🔓 Step 8: Granting API Gateway invoke permission..."
STATEMENT_ID="${FUNCTION_NAME}-api-gateway-invoke"
if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null | grep -q "$STATEMENT_ID"; then
    echo "  ✅ Permission already granted"
else
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id "$STATEMENT_ID" \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:${REGION}:$(aws sts get-caller-identity --query Account --output text):${API_ID}/*/*" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Permission granted"
fi

# Step 10: Create/update prod stage
echo ""
echo "🚀 Step 9: Creating/updating prod stage..."
if aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name prod --region "$REGION" &>/dev/null; then
    echo "  ✅ Stage already exists"
else
    aws apigatewayv2 create-stage \
        --api-id "$API_ID" \
        --stage-name prod \
        --auto-deploy \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Stage created"
fi

echo ""
echo "✅ AI infrastructure setup complete!"
echo ""
echo "📋 Summary:"
echo "  Lambda Function: $FUNCTION_NAME"
echo "  IAM Role: $ROLE_NAME"
echo "  API Gateway ID: $API_ID"
echo "  API URL: https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod"
echo ""
echo "🧪 Test the health endpoint:"
echo "  curl https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod/health"
echo ""
echo "Expected response:"
echo "  {\"status\":\"ok\"}"
echo ""
echo "To update the function code:"
echo "  1. Run 'make ai-zip' to rebuild"
echo "  2. Run this script again to update"
echo ""
echo "To view logs:"
echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"

