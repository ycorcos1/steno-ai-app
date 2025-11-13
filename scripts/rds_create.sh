#!/bin/bash
# Create RDS PostgreSQL instance and store credentials in Secrets Manager
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

if ! command -v openssl &> /dev/null; then
    echo "❌ Error: openssl is required but not installed."
    exit 1
fi

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

DB_INSTANCE_ID="${APP}-${ENV}-db"
DB_SUBNET_GROUP_NAME="${APP}-${ENV}-db-subnet-group"
DB_PARAMETER_GROUP_NAME="${APP}-${ENV}-db-params"
SECRET_NAME="/stenoai/${ENV}/db"
OUTPUT_FILE="/tmp/vpc-output.json"

echo "🗄️  Creating RDS PostgreSQL instance for StenoAI"
echo "================================================"
echo "DB Instance: $DB_INSTANCE_ID"
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
SG_RDS_ID=$(jq -r '.SecurityGroupRdsId' "$OUTPUT_FILE")

echo "VPC ID: $VPC_ID"
echo "Subnets: $SUBNET1_ID, $SUBNET2_ID"
echo "Security Group: $SG_RDS_ID"
echo ""

# Step 1: Create DB Subnet Group
echo "📦 Step 1: Creating DB Subnet Group..."
EXISTING_SUBNET_GROUP=$(aws rds describe-db-subnet-groups \
    --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
    --query 'DBSubnetGroups[0].DBSubnetGroupName' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SUBNET_GROUP" != "None" ] && [ -n "$EXISTING_SUBNET_GROUP" ]; then
    echo "  ✅ DB Subnet Group already exists: $DB_SUBNET_GROUP_NAME"
else
    aws rds create-db-subnet-group \
        --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
        --db-subnet-group-description "Subnet group for StenoAI RDS instance" \
        --subnet-ids "$SUBNET1_ID" "$SUBNET2_ID" \
        --tags "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ DB Subnet Group created: $DB_SUBNET_GROUP_NAME"
fi

# Step 2: Create DB Parameter Group
echo ""
echo "⚙️  Step 2: Creating DB Parameter Group..."
EXISTING_PARAM_GROUP=$(aws rds describe-db-parameter-groups \
    --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
    --query 'DBParameterGroups[0].DBParameterGroupName' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

EXISTING_FAMILY=$(aws rds describe-db-parameter-groups \
    --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
    --query 'DBParameterGroups[0].DBParameterGroupFamily' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_PARAM_GROUP" != "None" ] && [ -n "$EXISTING_PARAM_GROUP" ]; then
    if [ "$EXISTING_FAMILY" != "postgres14" ]; then
        echo "  ⚠️  Parameter group exists but with wrong family ($EXISTING_FAMILY), deleting..."
        aws rds delete-db-parameter-group \
            --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
            --region "$REGION" \
            > /dev/null
        echo "  ✅ Old parameter group deleted"
    else
        echo "  ✅ DB Parameter Group already exists: $DB_PARAMETER_GROUP_NAME"
    fi
fi

if [ "$EXISTING_PARAM_GROUP" == "None" ] || [ "$EXISTING_FAMILY" != "postgres14" ]; then
    aws rds create-db-parameter-group \
        --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
        --db-parameter-group-family postgres14 \
        --description "Parameter group for StenoAI RDS instance" \
        --tags "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
        --region "$REGION" \
        > /dev/null
    
    # Set UTF-8 encoding
    aws rds modify-db-parameter-group \
        --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
        --parameters "ParameterName=client_encoding,ParameterValue=UTF8,ApplyMethod=immediate" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ DB Parameter Group created: $DB_PARAMETER_GROUP_NAME"
fi

# Step 3: Check if DB instance already exists
echo ""
echo "🔍 Step 3: Checking for existing DB instance..."
EXISTING_DB=$(aws rds describe-db-instances \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --query 'DBInstances[0].DBInstanceStatus' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_DB" != "None" ] && [ -n "$EXISTING_DB" ]; then
    echo "  ✅ DB instance already exists: $DB_INSTANCE_ID (Status: $EXISTING_DB)"
    
    if [ "$EXISTING_DB" != "available" ]; then
        echo "  ⏳ Waiting for DB instance to be available..."
        aws rds wait db-instance-available \
            --db-instance-identifier "$DB_INSTANCE_ID" \
            --region "$REGION"
        echo "  ✅ DB instance is available"
    fi
    
    # Get endpoint
    DB_ENDPOINT=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --query 'DBInstances[0].Endpoint.Address' \
        --output text \
        --region "$REGION")
    
    echo "  DB Endpoint: $DB_ENDPOINT"
else
    # Step 4: Generate secure password
    echo ""
    echo "🔑 Step 4: Generating secure password..."
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    DB_USER="stenoai_admin"
    DB_NAME="stenoai"
    
    echo "  ✅ Password generated"
    
    # Step 5: Create RDS instance
    echo ""
    echo "🗄️  Step 5: Creating RDS PostgreSQL instance..."
    echo "  This may take 10-15 minutes..."
    
    aws rds create-db-instance \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --db-instance-class db.t4g.micro \
        --engine postgres \
        --engine-version 14.19 \
        --master-username "$DB_USER" \
        --master-user-password "$DB_PASSWORD" \
        --db-name "$DB_NAME" \
        --allocated-storage 20 \
        --storage-type gp3 \
        --storage-encrypted \
        --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
        --vpc-security-group-ids "$SG_RDS_ID" \
        --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
        --backup-retention-period 7 \
        --no-publicly-accessible \
        --enable-performance-insights \
        --performance-insights-retention-period 7 \
        --auto-minor-version-upgrade \
        --tags "Key=App,Value=$APP" "Key=Env,Value=$ENV" "Key=Name,Value=$DB_INSTANCE_ID" \
        --region "$REGION" \
        > /dev/null
    
    echo "  ✅ DB instance creation initiated"
    
    # Wait for DB to be available
    echo "  ⏳ Waiting for DB instance to be available (this may take 10-15 minutes)..."
    aws rds wait db-instance-available \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --region "$REGION"
    
    echo "  ✅ DB instance is available"
    
    # Get endpoint
    DB_ENDPOINT=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --query 'DBInstances[0].Endpoint.Address' \
        --output text \
        --region "$REGION")
    
    echo "  DB Endpoint: $DB_ENDPOINT"
    
    # Step 6: Store credentials in Secrets Manager
    echo ""
    echo "🔐 Step 6: Storing credentials in Secrets Manager..."
    
    SECRET_JSON=$(jq -n \
        --arg host "$DB_ENDPOINT" \
        --arg database "$DB_NAME" \
        --arg user "$DB_USER" \
        --arg password "$DB_PASSWORD" \
        '{
            PGHOST: $host,
            PGDATABASE: $database,
            PGUSER: $user,
            PGPASSWORD: $password
        }')
    
    # Check if secret already exists
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
        echo "  Updating existing secret..."
        aws secretsmanager update-secret \
            --secret-id "$SECRET_NAME" \
            --secret-string "$SECRET_JSON" \
            --region "$REGION" \
            > /dev/null
        echo "  ✅ Secret updated"
    else
        echo "  Creating new secret..."
        aws secretsmanager create-secret \
            --name "$SECRET_NAME" \
            --description "Database credentials for StenoAI $ENV environment" \
            --secret-string "$SECRET_JSON" \
            --tags "Key=App,Value=$APP" "Key=Env,Value=$ENV" \
            --region "$REGION" \
            > /dev/null
        echo "  ✅ Secret created"
    fi
fi

# If DB already existed, verify secret exists
if [ "$EXISTING_DB" != "None" ] && [ -n "$EXISTING_DB" ]; then
    if ! aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
        echo ""
        echo "⚠️  Warning: DB exists but secret not found. You may need to create the secret manually."
        echo "   Secret name: $SECRET_NAME"
    else
        echo ""
        echo "  ✅ Secret exists: $SECRET_NAME"
    fi
fi

echo ""
echo "✅ RDS setup complete!"
echo ""
echo "📋 Summary:"
echo "  DB Instance: $DB_INSTANCE_ID"
echo "  Endpoint: $DB_ENDPOINT"
echo "  Database: $DB_NAME"
echo "  Username: $DB_USER"
echo "  Secret: $SECRET_NAME"
echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/migrate.sh (will succeed with no migrations for now)"
echo "  2. Update Lambda to use VPC: bash scripts/api_create.sh"

