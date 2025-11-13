#!/bin/bash
# Create VPC, subnets, and security groups for StenoAI
set -euo pipefail

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed."
    echo "   Install with: brew install jq (macOS) or apt-get install jq (Linux)"
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

VPC_NAME="${APP}-${ENV}-vpc"
SG_LAMBDA_NAME="${APP}-${ENV}-sg-lambda"
SG_RDS_NAME="${APP}-${ENV}-sg-rds"
OUTPUT_FILE="/tmp/vpc-output.json"

echo "🌐 Creating VPC infrastructure for StenoAI"
echo "=========================================="
echo "VPC Name: $VPC_NAME"
echo "Region: $REGION"
echo ""

# Step 1: Get available AZs
echo "📍 Step 1: Getting available availability zones..."
AZS=($(aws ec2 describe-availability-zones \
    --region "$REGION" \
    --query 'AvailabilityZones[*].ZoneName' \
    --output text | tr '\t' '\n' | head -2))

if [ ${#AZS[@]} -lt 2 ]; then
    echo "❌ Error: Need at least 2 availability zones, found ${#AZS[@]}"
    exit 1
fi

AZ1="${AZS[0]}"
AZ2="${AZS[1]}"
echo "  ✅ Using AZs: $AZ1, $AZ2"

# Step 2: Create VPC
echo ""
echo "🔷 Step 2: Creating VPC..."
EXISTING_VPC=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=$VPC_NAME" "Name=tag:App,Values=$APP" "Name=tag:Env,Values=$ENV" \
    --query 'Vpcs[0].VpcId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_VPC" != "None" ] && [ -n "$EXISTING_VPC" ]; then
    VPC_ID="$EXISTING_VPC"
    echo "  ✅ VPC already exists: $VPC_ID"
else
    VPC_RESPONSE=$(aws ec2 create-vpc \
        --cidr-block 10.0.0.0/16 \
        --region "$REGION" \
        --output json)
    
    VPC_ID=$(echo "$VPC_RESPONSE" | jq -r '.Vpc.VpcId')
    
    # Tag VPC
    aws ec2 create-tags \
        --resources "$VPC_ID" \
        --tags "Key=Name,Value=$VPC_NAME" "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ VPC created: $VPC_ID"
fi

# Step 3: Create private subnets
echo ""
echo "🔷 Step 3: Creating private subnets..."
SUBNET1_NAME="${APP}-${ENV}-subnet-private-1"
SUBNET2_NAME="${APP}-${ENV}-subnet-private-2"

# Subnet 1
EXISTING_SUBNET1=$(aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=$SUBNET1_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[0].SubnetId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SUBNET1" != "None" ] && [ -n "$EXISTING_SUBNET1" ]; then
    SUBNET1_ID="$EXISTING_SUBNET1"
    echo "  ✅ Subnet 1 already exists: $SUBNET1_ID"
else
    SUBNET1_RESPONSE=$(aws ec2 create-subnet \
        --vpc-id "$VPC_ID" \
        --cidr-block 10.0.1.0/24 \
        --availability-zone "$AZ1" \
        --region "$REGION" \
        --output json)
    
    SUBNET1_ID=$(echo "$SUBNET1_RESPONSE" | jq -r '.Subnet.SubnetId')
    
    aws ec2 create-tags \
        --resources "$SUBNET1_ID" \
        --tags "Key=Name,Value=$SUBNET1_NAME" "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ Subnet 1 created: $SUBNET1_ID ($AZ1)"
fi

# Subnet 2
EXISTING_SUBNET2=$(aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=$SUBNET2_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[0].SubnetId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SUBNET2" != "None" ] && [ -n "$EXISTING_SUBNET2" ]; then
    SUBNET2_ID="$EXISTING_SUBNET2"
    echo "  ✅ Subnet 2 already exists: $SUBNET2_ID"
else
    SUBNET2_RESPONSE=$(aws ec2 create-subnet \
        --vpc-id "$VPC_ID" \
        --cidr-block 10.0.2.0/24 \
        --availability-zone "$AZ2" \
        --region "$REGION" \
        --output json)
    
    SUBNET2_ID=$(echo "$SUBNET2_RESPONSE" | jq -r '.Subnet.SubnetId')
    
    aws ec2 create-tags \
        --resources "$SUBNET2_ID" \
        --tags "Key=Name,Value=$SUBNET2_NAME" "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ Subnet 2 created: $SUBNET2_ID ($AZ2)"
fi

# Step 4: Create security group for Lambda
echo ""
echo "🔒 Step 4: Creating security group for Lambda..."
EXISTING_SG_LAMBDA=$(aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=$SG_LAMBDA_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SG_LAMBDA" != "None" ] && [ -n "$EXISTING_SG_LAMBDA" ]; then
    SG_LAMBDA_ID="$EXISTING_SG_LAMBDA"
    echo "  ✅ Lambda security group already exists: $SG_LAMBDA_ID"
else
    SG_LAMBDA_RESPONSE=$(aws ec2 create-security-group \
        --group-name "$SG_LAMBDA_NAME" \
        --description "Security group for StenoAI Lambda functions" \
        --vpc-id "$VPC_ID" \
        --region "$REGION" \
        --output json)
    
    SG_LAMBDA_ID=$(echo "$SG_LAMBDA_RESPONSE" | jq -r '.GroupId')
    
    aws ec2 create-tags \
        --resources "$SG_LAMBDA_ID" \
        --tags "Key=Name,Value=$SG_LAMBDA_NAME" "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    # Allow all egress (ignore if already exists)
    if ! aws ec2 authorize-security-group-egress \
        --group-id "$SG_LAMBDA_ID" \
        --ip-permissions IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}] \
        --region "$REGION" \
        2>/dev/null; then
        # Rule may already exist, which is fine
        echo "  ℹ️  Egress rule already exists (or default rule present)"
    fi
    
    echo "  ✅ Lambda security group created: $SG_LAMBDA_ID"
fi

# Step 5: Create security group for RDS
echo ""
echo "🔒 Step 5: Creating security group for RDS..."
EXISTING_SG_RDS=$(aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=$SG_RDS_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SG_RDS" != "None" ] && [ -n "$EXISTING_SG_RDS" ]; then
    SG_RDS_ID="$EXISTING_SG_RDS"
    echo "  ✅ RDS security group already exists: $SG_RDS_ID"
else
    SG_RDS_RESPONSE=$(aws ec2 create-security-group \
        --group-name "$SG_RDS_NAME" \
        --description "Security group for StenoAI RDS instance" \
        --vpc-id "$VPC_ID" \
        --region "$REGION" \
        --output json)
    
    SG_RDS_ID=$(echo "$SG_RDS_RESPONSE" | jq -r '.GroupId')
    
    aws ec2 create-tags \
        --resources "$SG_RDS_ID" \
        --tags "Key=Name,Value=$SG_RDS_NAME" "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ RDS security group created: $SG_RDS_ID"
fi

# Step 6: Configure RDS security group to allow Lambda access
echo ""
echo "🔒 Step 6: Configuring RDS security group rules..."
# Check if rule already exists
EXISTING_RULE=$(aws ec2 describe-security-group-rules \
    --filters "Name=group-id,Values=$SG_RDS_ID" "Name=referenced-group-id,Values=$SG_LAMBDA_ID" \
    --query 'SecurityGroupRules[0].SecurityGroupRuleId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_RULE" != "None" ] && [ -n "$EXISTING_RULE" ]; then
    echo "  ✅ Ingress rule already exists"
else
    if aws ec2 authorize-security-group-ingress \
        --group-id "$SG_RDS_ID" \
        --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$SG_LAMBDA_ID}] \
        --region "$REGION" \
        2>/dev/null; then
        echo "  ✅ Ingress rule added (port 5432 from Lambda SG)"
    else
        echo "  ⚠️  Failed to add ingress rule (may already exist)"
    fi
fi

# Step 7: Save output to JSON file
echo ""
echo "💾 Step 7: Saving VPC configuration..."
OUTPUT_JSON=$(jq -n \
    --arg vpcId "$VPC_ID" \
    --arg subnet1Id "$SUBNET1_ID" \
    --arg subnet2Id "$SUBNET2_ID" \
    --arg sgLambdaId "$SG_LAMBDA_ID" \
    --arg sgRdsId "$SG_RDS_ID" \
    --arg az1 "$AZ1" \
    --arg az2 "$AZ2" \
    '{
        VpcId: $vpcId,
        SubnetIds: [$subnet1Id, $subnet2Id],
        Subnet1Id: $subnet1Id,
        Subnet2Id: $subnet2Id,
        SecurityGroupLambdaId: $sgLambdaId,
        SecurityGroupRdsId: $sgRdsId,
        AvailabilityZone1: $az1,
        AvailabilityZone2: $az2
    }')

echo "$OUTPUT_JSON" > "$OUTPUT_FILE"
echo "  ✅ Configuration saved to $OUTPUT_FILE"

echo ""
echo "✅ VPC infrastructure setup complete!"
echo ""
echo "📋 Summary:"
echo "  VPC ID: $VPC_ID"
echo "  Subnet 1: $SUBNET1_ID ($AZ1)"
echo "  Subnet 2: $SUBNET2_ID ($AZ2)"
echo "  Lambda Security Group: $SG_LAMBDA_ID"
echo "  RDS Security Group: $SG_RDS_ID"
echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/vpc_endpoints.sh"
echo "  2. Run: bash scripts/rds_create.sh"

