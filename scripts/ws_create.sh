#!/bin/bash
# Create Lambda function and API Gateway WebSocket API for StenoAI real-time collaboration
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

FUNCTION_NAME="${APP}-${ENV}-ws"
ROLE_NAME="${APP}-${ENV}-api-role"  # Reuse API role
API_NAME="${APP}-${ENV}-ws"
ZIP_FILE="${PROJECT_ROOT}/apps/api/dist/api.zip"  # Same package as API (contains ws_handler)
REGION="${REGION}"

echo "🚀 Creating WebSocket infrastructure for StenoAI"
echo "================================================"
echo "Function: $FUNCTION_NAME"
echo "Role: $ROLE_NAME"
echo "API: $API_NAME"
echo "Region: $REGION"
echo ""

# Check if api.zip exists (WebSocket handler is in the same package)
if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Error: API package not found: $ZIP_FILE"
    echo "   Run 'make api-zip' first to build the package"
    exit 1
fi

# Step 1: Verify IAM role exists
echo "🔐 Step 1: Verifying IAM role..."
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo "  ✅ Role exists: $ROLE_NAME"
else
    echo "  ❌ Error: Role $ROLE_NAME does not exist"
    echo "  Please create the role manually or run with appropriate permissions"
    exit 1
fi

# Step 2: Attach WebSocket management policy
echo ""
echo "📋 Step 2: Attaching WebSocket management policy..."
cat > /tmp/ws-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "execute-api:ManageConnections"
      ],
      "Resource": "arn:aws:execute-api:${REGION}:*:*/*/@connections/*"
    }
  ]
}
EOF

aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name lambda-ws-policy \
    --policy-document "file:///tmp/ws-policy.json" \
    > /dev/null
echo "  ✅ WebSocket policy attached"

# Step 3: Wait for role propagation
echo ""
echo "⏳ Step 3: Waiting for IAM role propagation..."
sleep 10
echo "  ✅ Ready"

# Step 4: Get role ARN
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

# Step 5: Check for VPC configuration
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

# Step 6: Create or update Lambda function
echo ""
echo "⚡ Step 4: Creating/updating Lambda function..."
ENV_VARS="ENV=$ENV,REGION=$REGION,APP=$APP,SECRETS_PATH=/stenoai/${ENV}/app"

if aws lambda get-function --function-name "$FUNCTION_NAME" &>/dev/null; then
    echo "  Function exists, updating code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$ZIP_FILE" \
        --region "$REGION" \
        > /dev/null
    
    echo "  Waiting for update to complete..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
    
    # Update configuration
    if [ "$HAS_VPC_CONFIG" = true ]; then
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --handler "realtime/ws_handler.handler" \
            --timeout 60 \
            --memory-size 512 \
            --environment "Variables={$ENV_VARS}" \
            --vpc-config "SubnetIds=$SUBNET1_ID,$SUBNET2_ID,SecurityGroupIds=$SG_LAMBDA_ID" \
            --region "$REGION" \
            > /dev/null
    else
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --handler "realtime/ws_handler.handler" \
            --timeout 60 \
            --memory-size 512 \
            --environment "Variables={$ENV_VARS}" \
            --region "$REGION" \
            > /dev/null
    fi
    
    echo "  ✅ Function updated"
else
    if [ "$HAS_VPC_CONFIG" = true ]; then
        aws lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --runtime nodejs20.x \
            --role "$ROLE_ARN" \
            --handler "realtime/ws_handler.handler" \
            --zip-file "fileb://$ZIP_FILE" \
            --timeout 60 \
            --memory-size 512 \
            --environment "Variables={$ENV_VARS}" \
            --vpc-config "SubnetIds=$SUBNET1_ID,$SUBNET2_ID,SecurityGroupIds=$SG_LAMBDA_ID" \
            --description "StenoAI WebSocket Lambda function for real-time collaboration" \
            --region "$REGION" \
            > /dev/null
    else
        aws lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --runtime nodejs20.x \
            --role "$ROLE_ARN" \
            --handler "realtime/ws_handler.handler" \
            --zip-file "fileb://$ZIP_FILE" \
            --timeout 60 \
            --memory-size 512 \
            --environment "Variables={$ENV_VARS}" \
            --description "StenoAI WebSocket Lambda function for real-time collaboration" \
            --region "$REGION" \
            > /dev/null
    fi
    
    echo "  Waiting for function to be active..."
    aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
    
    echo "  ✅ Function created"
fi

# Step 7: Create WebSocket API
echo ""
echo "🌐 Step 5: Creating WebSocket API..."
EXISTING_API=$(aws apigatewayv2 get-apis \
    --query "Items[?Name=='$API_NAME'].ApiId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_API" ] && [ "$EXISTING_API" != "None" ]; then
    WS_API_ID="$EXISTING_API"
    echo "  ✅ API already exists: $WS_API_ID"
else
    echo "  Creating new WebSocket API..."
    WS_API_RESPONSE=$(aws apigatewayv2 create-api \
        --name "$API_NAME" \
        --protocol-type WEBSOCKET \
        --route-selection-expression '$request.body.action' \
        --region "$REGION" \
        --output json)
    
    WS_API_ID=$(echo "$WS_API_RESPONSE" | jq -r '.ApiId')
    echo "  ✅ API created: $WS_API_ID"
fi

# Step 8: Create Lambda integration
echo ""
echo "🔗 Step 6: Creating Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:${REGION}:$(aws sts get-caller-identity --query Account --output text):function:${FUNCTION_NAME}"

EXISTING_INTEGRATION=$(aws apigatewayv2 get-integrations \
    --api-id "$WS_API_ID" \
    --query "Items[?IntegrationUri=='$LAMBDA_ARN'].IntegrationId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_INTEGRATION" ] && [ "$EXISTING_INTEGRATION" != "None" ]; then
    INTEGRATION_ID="$EXISTING_INTEGRATION"
    echo "  ✅ Integration already exists: $INTEGRATION_ID"
else
    INTEGRATION_RESPONSE=$(aws apigatewayv2 create-integration \
        --api-id "$WS_API_ID" \
        --integration-type AWS_PROXY \
        --integration-uri "$LAMBDA_ARN" \
        --region "$REGION" \
        --output json)
    
    INTEGRATION_ID=$(echo "$INTEGRATION_RESPONSE" | jq -r '.IntegrationId')
    echo "  ✅ Integration created: $INTEGRATION_ID"
fi

# Step 9: Create routes
echo ""
echo "🛣️  Step 7: Creating WebSocket routes..."

# $connect route
echo "  Creating \$connect route..."
EXISTING_CONNECT=$(aws apigatewayv2 get-routes \
    --api-id "$WS_API_ID" \
    --query "Items[?RouteKey=='\\\$connect'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_CONNECT" ] && [ "$EXISTING_CONNECT" != "None" ]; then
    echo "    ✅ \$connect route already exists, updating..."
    aws apigatewayv2 update-route \
        --api-id "$WS_API_ID" \
        --route-id "$EXISTING_CONNECT" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
else
    aws apigatewayv2 create-route \
        --api-id "$WS_API_ID" \
        --route-key '$connect' \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "    ✅ \$connect route created"
fi

# $disconnect route
echo "  Creating \$disconnect route..."
EXISTING_DISCONNECT=$(aws apigatewayv2 get-routes \
    --api-id "$WS_API_ID" \
    --query "Items[?RouteKey=='\\\$disconnect'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_DISCONNECT" ] && [ "$EXISTING_DISCONNECT" != "None" ]; then
    echo "    ✅ \$disconnect route already exists, updating..."
    aws apigatewayv2 update-route \
        --api-id "$WS_API_ID" \
        --route-id "$EXISTING_DISCONNECT" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
else
    aws apigatewayv2 create-route \
        --api-id "$WS_API_ID" \
        --route-key '$disconnect' \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "    ✅ \$disconnect route created"
fi

# $default route
echo "  Creating \$default route..."
EXISTING_DEFAULT=$(aws apigatewayv2 get-routes \
    --api-id "$WS_API_ID" \
    --query "Items[?RouteKey=='\\\$default'].RouteId" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_DEFAULT" ] && [ "$EXISTING_DEFAULT" != "None" ]; then
    echo "    ✅ \$default route already exists, updating..."
    aws apigatewayv2 update-route \
        --api-id "$WS_API_ID" \
        --route-id "$EXISTING_DEFAULT" \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
else
    aws apigatewayv2 create-route \
        --api-id "$WS_API_ID" \
        --route-key '$default' \
        --target "integrations/$INTEGRATION_ID" \
        --region "$REGION" \
        > /dev/null
    echo "    ✅ \$default route created"
fi

# Step 10: Deploy stage
echo ""
echo "🚀 Step 8: Deploying WebSocket API stage..."
EXISTING_STAGE=$(aws apigatewayv2 get-stages \
    --api-id "$WS_API_ID" \
    --query "Items[?StageName=='prod'].StageName" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_STAGE" ] && [ "$EXISTING_STAGE" != "None" ]; then
    echo "  Stage exists, updating deployment..."
    aws apigatewayv2 create-deployment \
        --api-id "$WS_API_ID" \
        --stage-name "prod" \
        --region "$REGION" \
        > /dev/null
else
    aws apigatewayv2 create-stage \
        --api-id "$WS_API_ID" \
        --stage-name "prod" \
        --auto-deploy \
        --region "$REGION" \
        > /dev/null
fi
echo "  ✅ Stage deployed"

# Step 11: Grant Lambda permission to be invoked by API Gateway
echo ""
echo "🔐 Step 9: Granting Lambda invoke permission..."
STATEMENT_ID="${FUNCTION_NAME}-api-gw"
if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null | grep -q "$STATEMENT_ID"; then
    echo "  ✅ Permission already exists"
else
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id "$STATEMENT_ID" \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:${REGION}:$(aws sts get-caller-identity --query Account --output text):${WS_API_ID}/*/*" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Permission granted"
fi

# Step 12: Output WebSocket URL
echo ""
echo "✅ WebSocket infrastructure created successfully!"
echo ""
echo "📋 Configuration:"
echo "  WebSocket API ID: $WS_API_ID"
echo "  Lambda Function: $FUNCTION_NAME"
echo ""
WS_BASE_URL="wss://${WS_API_ID}.execute-api.${REGION}.amazonaws.com/prod"
echo "  WebSocket URL: $WS_BASE_URL"
echo ""
echo "💡 Next steps:"
echo "  1. Set VITE_WS_BASE_URL=$WS_BASE_URL in your frontend environment"
echo "  2. Add /auth/ws-token endpoint to return JWT for WebSocket connections"
echo "  3. Test collaboration by opening the same document in multiple tabs"
echo ""

# Save WebSocket URL to a file for reference
echo "$WS_BASE_URL" > "${PROJECT_ROOT}/.ws-url.txt"
echo "  WebSocket URL saved to .ws-url.txt"

