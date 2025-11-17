#!/bin/bash
# Attach DynamoDB policy to Lambda IAM roles
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

ROLE_NAME="${APP}-${ENV}-api-role"
POLICY_NAME="lambda-dynamodb-policy"
POLICY_FILE="${PROJECT_ROOT}/infra/api/lambda-dynamodb-policy.json"

echo "🔐 Attaching DynamoDB policy to Lambda role"
echo "============================================"
echo "Role: $ROLE_NAME"
echo "Policy: $POLICY_NAME"
echo ""

# Check if role exists
if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo "❌ Error: Role $ROLE_NAME does not exist"
    echo "  Please create the role first or check the role name"
    exit 1
fi

# Attach policy
echo "📋 Attaching policy..."
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$POLICY_NAME" \
    --policy-document "file://$POLICY_FILE" \
    > /dev/null

echo "  ✅ Policy attached successfully"
echo ""
echo "💡 Lambda functions using this role can now access DynamoDB tables"
echo "   Tables: stenoai-${ENV}-connections, stenoai-${ENV}-document-rooms"
echo ""

