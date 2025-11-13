#!/bin/bash
# Create VPC endpoints for Bedrock, S3, and Secrets Manager
set -euo pipefail

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed."
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is required but not installed."
    exit 1
fi

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

OUTPUT_FILE="/tmp/vpc-output.json"

echo "🔌 Creating VPC endpoints for StenoAI"
echo "===================================="
echo "Region: $REGION"
echo ""

# Check if VPC output exists
if [ ! -f "$OUTPUT_FILE" ]; then
    echo "❌ Error: VPC configuration not found: $OUTPUT_FILE"
    echo "   Run 'bash scripts/vpc_create.sh' first"
    exit 1
fi

# Read VPC configuration
VPC_ID=$(jq -r '.VpcId' "$OUTPUT_FILE")
SUBNET1_ID=$(jq -r '.Subnet1Id' "$OUTPUT_FILE")
SUBNET2_ID=$(jq -r '.Subnet2Id' "$OUTPUT_FILE")
SG_LAMBDA_ID=$(jq -r '.SecurityGroupLambdaId' "$OUTPUT_FILE")

echo "VPC ID: $VPC_ID"
echo "Subnets: $SUBNET1_ID, $SUBNET2_ID"
echo "Security Group: $SG_LAMBDA_ID"
echo ""

# Step 0: Enable DNS support for VPC (required for private DNS endpoints)
echo "🔧 Step 0: Enabling DNS support for VPC..."
aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-support \
    --region "$REGION" \
    > /dev/null

aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-hostnames \
    --region "$REGION" \
    > /dev/null

echo "  ✅ DNS support enabled"
echo ""

# Step 1: Create S3 Gateway Endpoint
echo "🪣 Step 1: Creating S3 Gateway Endpoint..."
EXISTING_S3_ENDPOINT=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=service-name,Values=com.amazonaws.$REGION.s3" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_S3_ENDPOINT" != "None" ] && [ -n "$EXISTING_S3_ENDPOINT" ]; then
    S3_ENDPOINT_ID="$EXISTING_S3_ENDPOINT"
    echo "  ✅ S3 Gateway Endpoint already exists: $S3_ENDPOINT_ID"
else
    S3_ENDPOINT_RESPONSE=$(aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "com.amazonaws.$REGION.s3" \
        --route-table-ids $(aws ec2 describe-route-tables \
            --filters "Name=vpc-id,Values=$VPC_ID" \
            --query 'RouteTables[*].RouteTableId' \
            --output text \
            --region "$REGION") \
        --region "$REGION" \
        --output json)
    
    S3_ENDPOINT_ID=$(echo "$S3_ENDPOINT_RESPONSE" | jq -r '.VpcEndpoint.VpcEndpointId')
    echo "  ✅ S3 Gateway Endpoint created: $S3_ENDPOINT_ID"
fi

# Step 2: Create Bedrock Runtime Interface Endpoint
echo ""
echo "🤖 Step 2: Creating Bedrock Runtime Interface Endpoint..."
BEDROCK_SERVICE="com.amazonaws.$REGION.bedrock-runtime"
EXISTING_BEDROCK_ENDPOINT=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=service-name,Values=$BEDROCK_SERVICE" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_BEDROCK_ENDPOINT" != "None" ] && [ -n "$EXISTING_BEDROCK_ENDPOINT" ]; then
    BEDROCK_ENDPOINT_ID="$EXISTING_BEDROCK_ENDPOINT"
    echo "  ✅ Bedrock Interface Endpoint already exists: $BEDROCK_ENDPOINT_ID"
else
    BEDROCK_ENDPOINT_RESPONSE=$(aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "$BEDROCK_SERVICE" \
        --vpc-endpoint-type Interface \
        --subnet-ids "$SUBNET1_ID" "$SUBNET2_ID" \
        --security-group-ids "$SG_LAMBDA_ID" \
        --private-dns-enabled \
        --region "$REGION" \
        --output json)
    
    BEDROCK_ENDPOINT_ID=$(echo "$BEDROCK_ENDPOINT_RESPONSE" | jq -r '.VpcEndpoint.VpcEndpointId')
    echo "  ✅ Bedrock Interface Endpoint created: $BEDROCK_ENDPOINT_ID"
    echo "  ⏳ Endpoint is being created (this may take a few minutes)..."
fi

# Step 3: Create Secrets Manager Interface Endpoint
echo ""
echo "🔐 Step 3: Creating Secrets Manager Interface Endpoint..."
SECRETS_SERVICE="com.amazonaws.$REGION.secretsmanager"
EXISTING_SECRETS_ENDPOINT=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=service-name,Values=$SECRETS_SERVICE" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SECRETS_ENDPOINT" != "None" ] && [ -n "$EXISTING_SECRETS_ENDPOINT" ]; then
    SECRETS_ENDPOINT_ID="$EXISTING_SECRETS_ENDPOINT"
    echo "  ✅ Secrets Manager Interface Endpoint already exists: $SECRETS_ENDPOINT_ID"
else
    SECRETS_ENDPOINT_RESPONSE=$(aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "$SECRETS_SERVICE" \
        --vpc-endpoint-type Interface \
        --subnet-ids "$SUBNET1_ID" "$SUBNET2_ID" \
        --security-group-ids "$SG_LAMBDA_ID" \
        --private-dns-enabled \
        --region "$REGION" \
        --output json)
    
    SECRETS_ENDPOINT_ID=$(echo "$SECRETS_ENDPOINT_RESPONSE" | jq -r '.VpcEndpoint.VpcEndpointId')
    echo "  ✅ Secrets Manager Interface Endpoint created: $SECRETS_ENDPOINT_ID"
    echo "  ⏳ Endpoint is being created (this may take a few minutes)..."
fi

# Step 4: Create Lambda Interface Endpoint (for Lambda-to-Lambda invocations)
echo ""
echo "⚡ Step 4: Creating Lambda Interface Endpoint..."
LAMBDA_SERVICE="com.amazonaws.$REGION.lambda"
EXISTING_LAMBDA_ENDPOINT=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=service-name,Values=$LAMBDA_SERVICE" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_LAMBDA_ENDPOINT" != "None" ] && [ -n "$EXISTING_LAMBDA_ENDPOINT" ]; then
    LAMBDA_ENDPOINT_ID="$EXISTING_LAMBDA_ENDPOINT"
    echo "  ✅ Lambda Interface Endpoint already exists: $LAMBDA_ENDPOINT_ID"
else
    LAMBDA_ENDPOINT_RESPONSE=$(aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "$LAMBDA_SERVICE" \
        --vpc-endpoint-type Interface \
        --subnet-ids "$SUBNET1_ID" "$SUBNET2_ID" \
        --security-group-ids "$SG_LAMBDA_ID" \
        --private-dns-enabled \
        --region "$REGION" \
        --output json)
    
    LAMBDA_ENDPOINT_ID=$(echo "$LAMBDA_ENDPOINT_RESPONSE" | jq -r '.VpcEndpoint.VpcEndpointId')
    echo "  ✅ Lambda Interface Endpoint created: $LAMBDA_ENDPOINT_ID"
    echo "  ⏳ Endpoint is being created (this may take a few minutes)..."
fi

# Step 3b: Add ingress rule to VPC endpoint security group to allow HTTPS from Lambda
echo ""
echo "🔒 Step 3b: Adding ingress rule to VPC endpoint security group..."
if ! aws ec2 authorize-security-group-ingress \
    --group-id "$SG_LAMBDA_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=443,ToPort=443,UserIdGroupPairs=[{GroupId=$SG_LAMBDA_ID}]" \
    --region "$REGION" \
    2>/dev/null; then
    echo "  ℹ️  Ingress rule already exists (or endpoint uses different security group)"
else
    echo "  ✅ Ingress rule added: HTTPS (443) from Lambda security group"
fi

# Update output file with endpoint IDs
echo ""
echo "💾 Updating VPC configuration with endpoint IDs..."
UPDATED_OUTPUT=$(jq \
    --arg s3Endpoint "$S3_ENDPOINT_ID" \
    --arg bedrockEndpoint "$BEDROCK_ENDPOINT_ID" \
    --arg secretsEndpoint "$SECRETS_ENDPOINT_ID" \
    --arg lambdaEndpoint "$LAMBDA_ENDPOINT_ID" \
    '. + {
        S3EndpointId: $s3Endpoint,
        BedrockEndpointId: $bedrockEndpoint,
        SecretsManagerEndpointId: $secretsEndpoint,
        LambdaEndpointId: $lambdaEndpoint
    }' "$OUTPUT_FILE")

echo "$UPDATED_OUTPUT" > "$OUTPUT_FILE"
echo "  ✅ Configuration updated"

echo ""
echo "✅ VPC endpoints setup complete!"
echo ""
echo "📋 Summary:"
echo "  S3 Gateway Endpoint: $S3_ENDPOINT_ID"
echo "  Bedrock Interface Endpoint: $BEDROCK_ENDPOINT_ID"
echo "  Secrets Manager Interface Endpoint: $SECRETS_ENDPOINT_ID"
echo "  Lambda Interface Endpoint: $LAMBDA_ENDPOINT_ID"
echo ""
echo "Next step:"
echo "  Run: bash scripts/rds_create.sh"

