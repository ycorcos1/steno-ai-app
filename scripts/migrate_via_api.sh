#!/bin/bash
# Apply database migrations via Lambda API endpoint (for RDS in private subnet)
set -euo pipefail

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed."
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "❌ Error: curl is required but not installed."
    exit 1
fi

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

MIGRATIONS_DIR="${PROJECT_ROOT}/apps/api/migrations"
API_ENDPOINT="https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod"

echo "🔄 Running database migrations via Lambda API for StenoAI"
echo "=========================================================="
echo "Environment: $ENV"
echo "Region: $REGION"
echo "Migrations directory: $MIGRATIONS_DIR"
echo "API Endpoint: $API_ENDPOINT"
echo ""

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "❌ Error: Migrations directory not found: $MIGRATIONS_DIR"
    exit 1
fi

# Get list of migration files
MIGRATION_FILES=($(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort))

if [ ${#MIGRATION_FILES[@]} -eq 0 ]; then
    echo "ℹ️  No migration files found in $MIGRATIONS_DIR"
    echo "  ✅ Migration script is ready for future migrations"
    exit 0
fi

echo "📦 Found ${#MIGRATION_FILES[@]} migration file(s)"
echo ""

# Test Lambda connection first
echo "🔌 Step 1: Testing Lambda database connection..."
DB_HEALTH=$(curl -s "$API_ENDPOINT/health/db")
if ! echo "$DB_HEALTH" | jq -e '.db == "ok"' > /dev/null; then
    echo "❌ Error: Lambda cannot connect to database"
    echo "   Response: $DB_HEALTH"
    echo "   Check Lambda logs and VPC configuration"
    exit 1
fi

echo "  ✅ Lambda can connect to database"
echo ""

# Step 2: Ensure schema_migrations table exists
echo "📋 Step 2: Ensuring schema_migrations table exists..."
SCHEMA_SQL="CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);"

SCHEMA_RESPONSE=$(curl -s -X POST "$API_ENDPOINT/migrate" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": $(echo "$SCHEMA_SQL" | jq -Rs .)}")

if ! echo "$SCHEMA_RESPONSE" | jq -e '.success == true' > /dev/null; then
    echo "  ⚠️  Warning: Could not create schema_migrations table"
    echo "     Response: $SCHEMA_RESPONSE"
    echo "     Continuing anyway..."
else
    echo "  ✅ Schema migrations table ready"
fi
echo ""

# Step 3: Apply migrations
APPLIED_COUNT=0
SKIPPED_COUNT=0
FAILED_COUNT=0

for MIGRATION_FILE in "${MIGRATION_FILES[@]}"; do
    MIGRATION_NAME=$(basename "$MIGRATION_FILE")
    MIGRATION_VERSION="${MIGRATION_NAME%.sql}"
    
    echo "🔄 Processing: $MIGRATION_NAME"
    
    # Check if already applied (via health/db endpoint query)
    # Note: We'll check this after applying, or assume it's idempotent
    
    # Read migration SQL
    MIGRATION_SQL=$(cat "$MIGRATION_FILE")
    
    # Apply migration
    echo "  📝 Applying migration..."
    MIGRATION_RESPONSE=$(curl -s -X POST "$API_ENDPOINT/migrate" \
        -H "Content-Type: application/json" \
        -d "{\"sql\": $(echo "$MIGRATION_SQL" | jq -Rs .)}")
    
    if echo "$MIGRATION_RESPONSE" | jq -e '.success == true' > /dev/null; then
        # Record migration (if schema_migrations table exists)
        RECORD_SQL="INSERT INTO schema_migrations (version) VALUES ('$MIGRATION_VERSION') ON CONFLICT (version) DO NOTHING;"
        curl -s -X POST "$API_ENDPOINT/migrate" \
            -H "Content-Type: application/json" \
            -d "{\"sql\": $(echo "$RECORD_SQL" | jq -Rs .)}" > /dev/null
        
        echo "  ✅ Migration applied successfully"
        ((APPLIED_COUNT++))
    else
        ERROR_MSG=$(echo "$MIGRATION_RESPONSE" | jq -r '.message // .error // "Unknown error"')
        # Check if error is "already exists" (idempotent)
        if echo "$ERROR_MSG" | grep -qi "already exists\|duplicate"; then
            echo "  ⏭️  Already applied (tables exist), skipping"
            ((SKIPPED_COUNT++))
        else
            echo "  ❌ Migration failed: $ERROR_MSG"
            echo "     Full response: $MIGRATION_RESPONSE"
            ((FAILED_COUNT++))
            echo ""
            echo "❌ Migration process failed at: $MIGRATION_NAME"
            exit 1
        fi
    fi
    
    echo ""
done

echo "✅ Migration process complete!"
echo ""
echo "📊 Summary:"
echo "  Applied: $APPLIED_COUNT"
echo "  Skipped: $SKIPPED_COUNT"
echo "  Failed: $FAILED_COUNT"
echo ""

