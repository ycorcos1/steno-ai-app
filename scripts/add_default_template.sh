#!/bin/bash
# Add default template to the database
# This script reads the migration SQL and executes it via the API's migrate endpoint

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="${PROJECT_ROOT}/apps/api/migrations/0005_default_template.sql"

# Source environment variables
source "$SCRIPT_DIR/env.sh"

# Get API URL from environment or use default
API_URL="${API_URL:-https://$(aws apigatewayv2 get-apis --region "$REGION" --query 'Items[?Name==`stenoai-${ENV}-api`].ApiEndpoint' --output text 2>/dev/null || echo '')}"

if [ -z "$API_URL" ] || [ "$API_URL" == "null" ] || [ "$API_URL" == "" ]; then
  echo "❌ Error: Could not determine API URL"
  echo "   Set API_URL environment variable or ensure API Gateway exists"
  exit 1
fi

echo "🔄 Adding default template to database"
echo "==========================================="
echo "Environment: $ENV"
echo "API URL: $API_URL"
echo "Migration file: $MIGRATION_FILE"
echo ""

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

# Read the SQL from the migration file (skip BEGIN/COMMIT if present, as the endpoint handles transactions)
SQL_CONTENT=$(cat "$MIGRATION_FILE" | sed 's/^BEGIN;//' | sed 's/^COMMIT;//' | tr -d '\n' | sed 's/;/;\n/g')

echo "📝 Executing migration..."
echo ""

# Execute via migrate endpoint
RESPONSE=$(curl -s -X POST "${API_URL}/migrate" \
  -H "Content-Type: application/json" \
  -d "{\"sql\": $(echo "$SQL_CONTENT" | jq -Rs .)}" \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "✅ Default template added successfully"
  echo "$BODY" | jq -r '.message // .'
else
  echo "❌ Failed to add default template"
  echo "HTTP Status: $HTTP_CODE"
  echo "$BODY" | jq -r '.error // .message // .' 2>/dev/null || echo "$BODY"
  exit 1
fi

echo ""
echo "✅ Script complete"

