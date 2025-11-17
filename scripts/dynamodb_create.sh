#!/bin/bash
# Create DynamoDB tables for StenoAI real-time collaboration
set -euo pipefail

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

REGION="${REGION}"
APP="${APP}"
ENV="${ENV}"

echo "🗄️  Creating DynamoDB tables for StenoAI collaboration"
echo "======================================================"
echo "Region: $REGION"
echo "Environment: $ENV"
echo ""

# Table 1: Connections Table
CONNECTIONS_TABLE="${APP}-${ENV}-connections"
echo "📋 Creating connections table: $CONNECTIONS_TABLE"

if aws dynamodb describe-table --table-name "$CONNECTIONS_TABLE" --region "$REGION" &>/dev/null; then
    echo "  ✅ Table already exists: $CONNECTIONS_TABLE"
else
    aws dynamodb create-table \
        --table-name "$CONNECTIONS_TABLE" \
        --attribute-definitions \
            AttributeName=connectionId,AttributeType=S \
            AttributeName=userId,AttributeType=S \
            AttributeName=documentId,AttributeType=S \
        --key-schema \
            AttributeName=connectionId,KeyType=HASH \
        --global-secondary-indexes \
            "[
                {
                    \"IndexName\": \"userId-index\",
                    \"KeySchema\": [{\"AttributeName\":\"userId\",\"KeyType\":\"HASH\"}],
                    \"Projection\": {\"ProjectionType\":\"ALL\"},
                    \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
                },
                {
                    \"IndexName\": \"documentId-index\",
                    \"KeySchema\": [{\"AttributeName\":\"documentId\",\"KeyType\":\"HASH\"}],
                    \"Projection\": {\"ProjectionType\":\"ALL\"},
                    \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
                }
            ]" \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --tags Key=App,Value=$APP Key=Env,Value=$ENV \
        --region "$REGION" \
        > /dev/null
    
    echo "  ⏳ Waiting for table to be active..."
    aws dynamodb wait table-exists --table-name "$CONNECTIONS_TABLE" --region "$REGION"
    echo "  ✅ Table created: $CONNECTIONS_TABLE"
fi

# Enable TTL on connections table (auto-cleanup stale connections)
echo ""
echo "⏰ Enabling TTL on connections table..."
aws dynamodb update-time-to-live \
    --table-name "$CONNECTIONS_TABLE" \
    --time-to-live-specification "Enabled=true,AttributeName=ttl" \
    --region "$REGION" \
    > /dev/null 2>&1 || echo "  ⚠️  TTL already enabled or update in progress"
echo "  ✅ TTL configured (connections expire after 1 hour)"

# Table 2: Document Rooms Table (optional but useful for presence)
ROOMS_TABLE="${APP}-${ENV}-document-rooms"
echo ""
echo "📋 Creating document rooms table: $ROOMS_TABLE"

if aws dynamodb describe-table --table-name "$ROOMS_TABLE" --region "$REGION" &>/dev/null; then
    echo "  ✅ Table already exists: $ROOMS_TABLE"
else
    aws dynamodb create-table \
        --table-name "$ROOMS_TABLE" \
        --attribute-definitions \
            AttributeName=documentId,AttributeType=S \
        --key-schema \
            AttributeName=documentId,KeyType=HASH \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --tags Key=App,Value=$APP Key=Env,Value=$ENV \
        --region "$REGION" \
        > /dev/null
    
    echo "  ⏳ Waiting for table to be active..."
    aws dynamodb wait table-exists --table-name "$ROOMS_TABLE" --region "$REGION"
    echo "  ✅ Table created: $ROOMS_TABLE"
fi

echo ""
echo "✅ DynamoDB tables created successfully!"
echo ""
echo "📋 Created tables:"
echo "  1. $CONNECTIONS_TABLE - WebSocket connection tracking"
echo "  2. $ROOMS_TABLE - Document room management"
echo ""
echo "💡 Next steps:"
echo "  1. Update Lambda IAM role with DynamoDB permissions (run attach_dynamodb_policy.sh)"
echo "  2. Update ws_handler.ts to use DynamoDB instead of in-memory Map"
echo "  3. Test WebSocket connections"
echo ""

