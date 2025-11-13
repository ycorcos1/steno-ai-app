#!/bin/bash
# Create S3 buckets for uploads and exports, configure CORS, and grant Lambda permissions
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

UPLOAD_BUCKET="${APP}-${ENV}-uploads"
EXPORT_BUCKET="${APP}-${ENV}-exports"
ROLE_NAME="${APP}-${ENV}-api-role"
REGION="${REGION}"

echo "🪣 Creating S3 buckets for StenoAI"
echo "==================================="
echo "Upload Bucket: $UPLOAD_BUCKET"
echo "Export Bucket: $EXPORT_BUCKET"
echo "Region: $REGION"
echo ""

# Step 1: Create uploads bucket
echo "📦 Step 1: Creating uploads bucket..."
if aws s3api head-bucket --bucket "$UPLOAD_BUCKET" --region "$REGION" 2>/dev/null; then
    echo "  ✅ Bucket already exists: $UPLOAD_BUCKET"
else
    if [ "$REGION" == "us-east-1" ]; then
        # us-east-1 doesn't require LocationConstraint
        aws s3api create-bucket \
            --bucket "$UPLOAD_BUCKET" \
            --region "$REGION" \
            > /dev/null
    else
        aws s3api create-bucket \
            --bucket "$UPLOAD_BUCKET" \
            --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION" \
            > /dev/null
    fi
    echo "  ✅ Bucket created: $UPLOAD_BUCKET"
fi

# Step 2: Create exports bucket
echo ""
echo "📦 Step 2: Creating exports bucket..."
if aws s3api head-bucket --bucket "$EXPORT_BUCKET" --region "$REGION" 2>/dev/null; then
    echo "  ✅ Bucket already exists: $EXPORT_BUCKET"
else
    if [ "$REGION" == "us-east-1" ]; then
        aws s3api create-bucket \
            --bucket "$EXPORT_BUCKET" \
            --region "$REGION" \
            > /dev/null
    else
        aws s3api create-bucket \
            --bucket "$EXPORT_BUCKET" \
            --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION" \
            > /dev/null
    fi
    echo "  ✅ Bucket created: $EXPORT_BUCKET"
fi

# Step 3: Enable versioning on both buckets
echo ""
echo "🔄 Step 3: Enabling versioning..."
aws s3api put-bucket-versioning \
    --bucket "$UPLOAD_BUCKET" \
    --versioning-configuration Status=Enabled \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Versioning enabled on $UPLOAD_BUCKET"

aws s3api put-bucket-versioning \
    --bucket "$EXPORT_BUCKET" \
    --versioning-configuration Status=Enabled \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Versioning enabled on $EXPORT_BUCKET"

# Step 4: Block public access
echo ""
echo "🔒 Step 4: Blocking public access..."
aws s3api put-public-access-block \
    --bucket "$UPLOAD_BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Public access blocked on $UPLOAD_BUCKET"

aws s3api put-public-access-block \
    --bucket "$EXPORT_BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Public access blocked on $EXPORT_BUCKET"

# Step 5: Configure CORS on uploads bucket
echo ""
echo "🌐 Step 5: Configuring CORS on uploads bucket..."
aws s3api put-bucket-cors \
    --bucket "$UPLOAD_BUCKET" \
    --cors-configuration "file://${PROJECT_ROOT}/infra/web/s3-cors.json" \
    --region "$REGION" \
    > /dev/null
echo "  ✅ CORS configured on $UPLOAD_BUCKET"

# Step 6: Tag buckets
echo ""
echo "🏷️  Step 6: Tagging buckets..."
aws s3api put-bucket-tagging \
    --bucket "$UPLOAD_BUCKET" \
    --tagging "TagSet=[{Key=Environment,Value=$ENV},{Key=App,Value=$APP}]" \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Tags applied to $UPLOAD_BUCKET"

aws s3api put-bucket-tagging \
    --bucket "$EXPORT_BUCKET" \
    --tagging "TagSet=[{Key=Environment,Value=$ENV},{Key=App,Value=$APP}]" \
    --region "$REGION" \
    > /dev/null
echo "  ✅ Tags applied to $EXPORT_BUCKET"

# Step 7: Add S3 permissions to Lambda role
echo ""
echo "🔐 Step 7: Adding S3 permissions to Lambda role..."
if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo "  ⚠️  Warning: Lambda role $ROLE_NAME does not exist yet."
    echo "     Run 'bash scripts/api_create.sh' first to create the role."
    echo "     S3 permissions will need to be added manually after role creation."
else
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name S3Access \
        --policy-document "file://${PROJECT_ROOT}/infra/api/lambda-s3-policy.json" \
        > /dev/null
    echo "  ✅ S3 permissions added to $ROLE_NAME"
fi

# Step 8: Update Lambda environment variables (if function exists)
echo ""
echo "⚙️  Step 8: Updating Lambda environment variables..."
FUNCTION_NAME="${APP}-${ENV}-api"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
    # Get current environment variables
    CURRENT_ENV=$(aws lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --query 'Environment.Variables' \
        --output json 2>/dev/null || echo "{}")
    
    # Extract existing variables and merge with new S3 bucket variables
    EXISTING_VARS=$(echo "$CURRENT_ENV" | jq -r 'to_entries | map("\(.key)=\(.value)") | join(",")' 2>/dev/null || echo "")
    
    # Build environment variables string
    if [ -n "$EXISTING_VARS" ]; then
        ENV_VARS="${EXISTING_VARS},S3_UPLOAD_BUCKET=${UPLOAD_BUCKET},S3_EXPORT_BUCKET=${EXPORT_BUCKET}"
    else
        ENV_VARS="ENV=${ENV},REGION=${REGION},APP=${APP},S3_UPLOAD_BUCKET=${UPLOAD_BUCKET},S3_EXPORT_BUCKET=${EXPORT_BUCKET}"
    fi
    
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment "Variables={${ENV_VARS}}" \
        --region "$REGION" \
        > /dev/null
    echo "  ✅ Lambda environment variables updated"
else
    echo "  ⚠️  Lambda function $FUNCTION_NAME does not exist yet."
    echo "     Environment variables will be set when function is created."
fi

echo ""
echo "✅ S3 bucket infrastructure setup complete!"
echo ""
echo "📋 Summary:"
echo "  Upload Bucket: s3://$UPLOAD_BUCKET"
echo "  Export Bucket: s3://$EXPORT_BUCKET"
echo "  Versioning: Enabled on both buckets"
echo "  Public Access: Blocked on both buckets"
echo "  CORS: Configured on uploads bucket"
echo ""
echo "🧪 Test bucket access:"
echo "  aws s3 ls s3://$UPLOAD_BUCKET/"
echo "  aws s3 ls s3://$EXPORT_BUCKET/"
echo ""

