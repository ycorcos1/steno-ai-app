#!/bin/bash
# Create S3 bucket and CloudFront distribution for StenoAI static web hosting
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

BUCKET_NAME="${APP}-${ENV}-web"
REGION="${REGION}"
TIMESTAMP=$(date +%s)

echo "🚀 Creating static hosting for StenoAI"
echo "======================================"
echo "Bucket: $BUCKET_NAME"
echo "Region: $REGION"
echo ""

# Step 1: Create S3 bucket if it doesn't exist
echo "📦 Step 1: Creating S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "  ✅ Bucket already exists"
else
    echo "  Creating bucket: $BUCKET_NAME"
    if [ "$REGION" = "us-east-1" ]; then
        aws s3 mb "s3://$BUCKET_NAME"
    else
        aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
    fi
    echo "  ✅ Bucket created"
fi

# Step 2: Configure bucket for static website hosting
echo ""
echo "🌐 Step 2: Configuring static website hosting..."
aws s3 website "s3://$BUCKET_NAME" \
    --index-document index.html \
    --error-document index.html \
    --region "$REGION" > /dev/null 2>&1 || true
echo "  ✅ Website hosting configured"

# Step 3: Create CloudFront Origin Access Identity (OAI)
echo ""
echo "🔐 Step 3: Creating CloudFront Origin Access Identity..."
OAI_COMMENT="stenoai-${ENV}-web-oai"

# Check if OAI already exists
EXISTING_OAI=$(aws cloudfront list-cloud-front-origin-access-identities \
    --query "CloudFrontOriginAccessIdentityList.Items[?Comment=='$OAI_COMMENT'].Id" \
    --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_OAI" ] || [ "$EXISTING_OAI" = "None" ]; then
    echo "  Creating new OAI..."
    OAI_RESPONSE=$(aws cloudfront create-cloud-front-origin-access-identity \
        --cloud-front-origin-access-identity-config \
        "CallerReference=stenoai-oai-$TIMESTAMP,Comment=$OAI_COMMENT" \
        --output json)
    OAI_ID=$(echo "$OAI_RESPONSE" | jq -r '.CloudFrontOriginAccessIdentity.Id')
    OAI_ETAG=$(echo "$OAI_RESPONSE" | jq -r '.ETag')
    echo "  ✅ OAI created: $OAI_ID"
else
    OAI_ID="$EXISTING_OAI"
    OAI_ETAG=$(aws cloudfront get-cloud-front-origin-access-identity \
        --id "$OAI_ID" \
        --query 'ETag' \
        --output text 2>/dev/null || echo "")
    echo "  ✅ OAI already exists: $OAI_ID"
fi

OAI_ARN="origin-access-identity/cloudfront/$OAI_ID"

# Step 4: Set bucket policy to allow CloudFront OAI access only
echo ""
echo "🔒 Step 4: Configuring S3 bucket policy..."
BUCKET_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity $OAI_ID"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF
)

echo "$BUCKET_POLICY" > /tmp/bucket-policy.json
aws s3api put-bucket-policy \
    --bucket "$BUCKET_NAME" \
    --policy file:///tmp/bucket-policy.json \
    --region "$REGION"
rm -f /tmp/bucket-policy.json
echo "  ✅ Bucket policy configured"

# Step 5: Build frontend
echo ""
echo "🔨 Step 5: Building frontend..."
cd "$PROJECT_ROOT"
npm --prefix apps/web run build
echo "  ✅ Frontend built"

# Step 6: Sync to S3
echo ""
echo "📤 Step 6: Syncing files to S3..."
aws s3 sync apps/web/dist/ "s3://$BUCKET_NAME" \
    --delete \
    --region "$REGION" \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "*.html" \
    --exclude "service-worker.js"
aws s3 sync apps/web/dist/ "s3://$BUCKET_NAME" \
    --delete \
    --region "$REGION" \
    --cache-control "public, max-age=0, must-revalidate" \
    --include "*.html" \
    --include "service-worker.js"
echo "  ✅ Files synced to S3"

# Step 7: Get bucket domain name
BUCKET_DOMAIN="$BUCKET_NAME.s3.$REGION.amazonaws.com"
if [ "$REGION" = "us-east-1" ]; then
    BUCKET_DOMAIN="$BUCKET_NAME.s3.amazonaws.com"
fi

# Step 8: Create CloudFront distribution
echo ""
echo "☁️  Step 7: Creating CloudFront distribution..."

# Check if distribution already exists
EXISTING_DIST=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='StenoAI Static Web Hosting'].Id" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_DIST" ] && [ "$EXISTING_DIST" != "None" ]; then
    echo "  ⚠️  Distribution already exists: $EXISTING_DIST"
    echo "  Use 'aws cloudfront get-distribution --id $EXISTING_DIST' to check status"
    DIST_ID="$EXISTING_DIST"
else
    # Prepare CloudFront config
    CF_CONFIG_FILE="/tmp/cloudfront-config.json"
    sed -e "s/REPLACE_TIMESTAMP/$TIMESTAMP/g" \
        -e "s/REPLACE_ENV/$ENV/g" \
        -e "s|REPLACE_BUCKET_DOMAIN|$BUCKET_DOMAIN|g" \
        -e "s|REPLACE_OAI_ID|$OAI_ARN|g" \
        "$PROJECT_ROOT/infra/web/cloudfront.json" > "$CF_CONFIG_FILE"
    
    echo "  Creating distribution..."
    DIST_RESPONSE=$(aws cloudfront create-distribution \
        --distribution-config "file://$CF_CONFIG_FILE" \
        --output json)
    
    DIST_ID=$(echo "$DIST_RESPONSE" | jq -r '.Distribution.Id')
    DIST_DOMAIN=$(echo "$DIST_RESPONSE" | jq -r '.Distribution.DomainName')
    DIST_STATUS=$(echo "$DIST_RESPONSE" | jq -r '.Distribution.Status')
    
    rm -f "$CF_CONFIG_FILE"
    
    echo "  ✅ Distribution created: $DIST_ID"
    echo "  📍 Domain: https://$DIST_DOMAIN"
    echo "  ⏳ Status: $DIST_STATUS (deployment may take 10-20 minutes)"
fi

echo ""
echo "✅ Static hosting setup complete!"
echo ""
echo "📋 Summary:"
echo "  Bucket: $BUCKET_NAME"
echo "  CloudFront ID: $DIST_ID"
if [ -n "${DIST_DOMAIN:-}" ]; then
    echo "  CloudFront URL: https://$DIST_DOMAIN"
    echo ""
    echo "🌐 Your site will be available at: https://$DIST_DOMAIN"
    echo "   (Note: Initial deployment takes 10-20 minutes)"
fi
echo ""
echo "To check distribution status:"
echo "  aws cloudfront get-distribution --id $DIST_ID --query 'Distribution.Status'"
echo ""
echo "To invalidate cache after updates:"
echo "  aws cloudfront create-invalidation --distribution-id $DIST_ID --paths '/*'"

