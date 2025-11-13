#!/bin/bash
# Configure S3 lifecycle policies for cost optimization
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
REGION="${REGION}"

UPLOAD_LIFECYCLE_CONFIG="${PROJECT_ROOT}/infra/s3/lifecycle-uploads.json"
EXPORT_LIFECYCLE_CONFIG="${PROJECT_ROOT}/infra/s3/lifecycle-exports.json"

echo "🔄 Configuring S3 lifecycle policies for StenoAI"
echo "================================================="
echo "Upload Bucket: $UPLOAD_BUCKET"
echo "Export Bucket: $EXPORT_BUCKET"
echo "Region: $REGION"
echo ""

# Verify buckets exist
echo "🔍 Step 1: Verifying buckets exist..."
if ! aws s3api head-bucket --bucket "$UPLOAD_BUCKET" --region "$REGION" 2>/dev/null; then
    echo "  ❌ Error: Upload bucket $UPLOAD_BUCKET does not exist."
    echo "     Run 'bash scripts/data_buckets_create.sh' first to create buckets."
    exit 1
fi
echo "  ✅ Upload bucket exists: $UPLOAD_BUCKET"

if ! aws s3api head-bucket --bucket "$EXPORT_BUCKET" --region "$REGION" 2>/dev/null; then
    echo "  ❌ Error: Export bucket $EXPORT_BUCKET does not exist."
    echo "     Run 'bash scripts/data_buckets_create.sh' first to create buckets."
    exit 1
fi
echo "  ✅ Export bucket exists: $EXPORT_BUCKET"

# Verify lifecycle config files exist
echo ""
echo "📄 Step 2: Verifying lifecycle configuration files..."
if [ ! -f "$UPLOAD_LIFECYCLE_CONFIG" ]; then
    echo "  ❌ Error: Lifecycle config file not found: $UPLOAD_LIFECYCLE_CONFIG"
    exit 1
fi
echo "  ✅ Upload lifecycle config found"

if [ ! -f "$EXPORT_LIFECYCLE_CONFIG" ]; then
    echo "  ❌ Error: Lifecycle config file not found: $EXPORT_LIFECYCLE_CONFIG"
    exit 1
fi
echo "  ✅ Export lifecycle config found"

# Validate JSON files
echo ""
echo "✅ Step 3: Validating JSON configuration..."
if ! jq empty "$UPLOAD_LIFECYCLE_CONFIG" 2>/dev/null; then
    echo "  ❌ Error: Invalid JSON in $UPLOAD_LIFECYCLE_CONFIG"
    exit 1
fi
echo "  ✅ Upload lifecycle JSON is valid"

if ! jq empty "$EXPORT_LIFECYCLE_CONFIG" 2>/dev/null; then
    echo "  ❌ Error: Invalid JSON in $EXPORT_LIFECYCLE_CONFIG"
    exit 1
fi
echo "  ✅ Export lifecycle JSON is valid"

# Apply lifecycle policy to uploads bucket
echo ""
echo "📋 Step 4: Applying lifecycle policy to uploads bucket..."
if aws s3api put-bucket-lifecycle-configuration \
    --bucket "$UPLOAD_BUCKET" \
    --lifecycle-configuration "file://${UPLOAD_LIFECYCLE_CONFIG}" \
    --region "$REGION" \
    2>&1; then
    echo "  ✅ Lifecycle policy applied to $UPLOAD_BUCKET"
else
    echo "  ❌ Error: Failed to apply lifecycle policy to $UPLOAD_BUCKET"
    exit 1
fi

# Apply lifecycle policy to exports bucket
echo ""
echo "📋 Step 5: Applying lifecycle policy to exports bucket..."
if aws s3api put-bucket-lifecycle-configuration \
    --bucket "$EXPORT_BUCKET" \
    --lifecycle-configuration "file://${EXPORT_LIFECYCLE_CONFIG}" \
    --region "$REGION" \
    2>&1; then
    echo "  ✅ Lifecycle policy applied to $EXPORT_BUCKET"
else
    echo "  ❌ Error: Failed to apply lifecycle policy to $EXPORT_BUCKET"
    exit 1
fi

# Verify lifecycle rules are active
echo ""
echo "🔍 Step 6: Verifying lifecycle rules are active..."
UPLOAD_RULES=$(aws s3api get-bucket-lifecycle-configuration \
    --bucket "$UPLOAD_BUCKET" \
    --region "$REGION" \
    --query 'Rules[*].ID' \
    --output json 2>/dev/null || echo "[]")

UPLOAD_RULE_COUNT=$(echo "$UPLOAD_RULES" | jq 'length')
echo "  ✅ Upload bucket has $UPLOAD_RULE_COUNT lifecycle rule(s):"
echo "$UPLOAD_RULES" | jq -r '.[]' | sed 's/^/    - /'

EXPORT_RULES=$(aws s3api get-bucket-lifecycle-configuration \
    --bucket "$EXPORT_BUCKET" \
    --region "$REGION" \
    --query 'Rules[*].ID' \
    --output json 2>/dev/null || echo "[]")

EXPORT_RULE_COUNT=$(echo "$EXPORT_RULES" | jq 'length')
echo "  ✅ Export bucket has $EXPORT_RULE_COUNT lifecycle rule(s):"
echo "$EXPORT_RULES" | jq -r '.[]' | sed 's/^/    - /'

echo ""
echo "✅ S3 lifecycle configuration complete!"
echo ""
echo "📋 Summary:"
echo "  Upload Bucket: s3://$UPLOAD_BUCKET"
echo "    - Current versions deleted after 30 days"
echo "    - Noncurrent versions transition to STANDARD_IA after 30 days"
echo "    - Noncurrent versions deleted after 60 days"
echo "    - Delete markers cleaned up automatically"
echo ""
echo "  Export Bucket: s3://$EXPORT_BUCKET"
echo "    - Current versions deleted after 14 days"
echo "    - Noncurrent versions transition to STANDARD_IA after 30 days"
echo "    - Noncurrent versions deleted after 30 days"
echo "    - Delete markers cleaned up automatically"
echo ""
echo "🧪 Verify lifecycle rules:"
echo "  aws s3api get-bucket-lifecycle-configuration \\"
echo "    --bucket $UPLOAD_BUCKET --region $REGION | jq '.Rules'"
echo ""
echo "  aws s3api get-bucket-lifecycle-configuration \\"
echo "    --bucket $EXPORT_BUCKET --region $REGION | jq '.Rules'"
echo ""

