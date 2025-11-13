#!/bin/bash
# Apply database migrations from apps/api/migrations/
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

if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is required but not installed."
    echo "   Install PostgreSQL client tools"
    exit 1
fi

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

SECRET_NAME="/stenoai/${ENV}/db"
MIGRATIONS_DIR="${PROJECT_ROOT}/apps/api/migrations"

echo "🔄 Running database migrations for StenoAI"
echo "==========================================="
echo "Environment: $ENV"
echo "Region: $REGION"
echo "Migrations directory: $MIGRATIONS_DIR"
echo ""

# Step 1: Fetch credentials from Secrets Manager
echo "🔐 Step 1: Fetching database credentials..."
if ! aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
    echo "❌ Error: Secret not found: $SECRET_NAME"
    echo "   Run 'bash scripts/rds_create.sh' first"
    exit 1
fi

SECRET_VALUE=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --region "$REGION" \
    --query 'SecretString' \
    --output text)

PGHOST=$(echo "$SECRET_VALUE" | jq -r '.PGHOST')
PGDATABASE=$(echo "$SECRET_VALUE" | jq -r '.PGDATABASE')
PGUSER=$(echo "$SECRET_VALUE" | jq -r '.PGUSER')
PGPASSWORD=$(echo "$SECRET_VALUE" | jq -r '.PGPASSWORD')

if [ -z "$PGHOST" ] || [ "$PGHOST" == "null" ]; then
    echo "❌ Error: Failed to parse database credentials from secret"
    exit 1
fi

echo "  ✅ Credentials retrieved"
echo "  Host: $PGHOST"
echo "  Database: $PGDATABASE"
echo "  User: $PGUSER"
echo ""

# Export for psql
export PGHOST
export PGDATABASE
export PGUSER
export PGPASSWORD

# Step 2: Test connection
echo "🔌 Step 2: Testing database connection..."
if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" &>/dev/null; then
    echo "❌ Error: Failed to connect to database"
    echo "   Check that RDS instance is running and security groups are configured"
    exit 1
fi

echo "  ✅ Connection successful"
echo ""

# Step 3: Create schema_migrations table if it doesn't exist
echo "📋 Step 3: Ensuring schema_migrations table exists..."
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" <<EOF
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
EOF

echo "  ✅ Schema migrations table ready"
echo ""

# Step 4: Get list of migration files
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "📁 Creating migrations directory..."
    mkdir -p "$MIGRATIONS_DIR"
    echo "  ✅ Directory created"
    echo ""
fi

MIGRATION_FILES=($(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort))

if [ ${#MIGRATION_FILES[@]} -eq 0 ]; then
    echo "ℹ️  No migration files found in $MIGRATIONS_DIR"
    echo "  ✅ Migration script is ready for future migrations"
    echo ""
    echo "✅ Migration process complete (no migrations to apply)"
    exit 0
fi

echo "📦 Step 4: Found ${#MIGRATION_FILES[@]} migration file(s)"
echo ""

# Step 5: Apply migrations
APPLIED_COUNT=0
SKIPPED_COUNT=0
FAILED_COUNT=0

for MIGRATION_FILE in "${MIGRATION_FILES[@]}"; do
    MIGRATION_NAME=$(basename "$MIGRATION_FILE")
    MIGRATION_VERSION="${MIGRATION_NAME%.sql}"
    
    echo "🔄 Processing: $MIGRATION_NAME"
    
    # Check if already applied
    IS_APPLIED=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -t -c \
        "SELECT COUNT(*) FROM schema_migrations WHERE version = '$MIGRATION_VERSION';" | tr -d ' ')
    
    if [ "$IS_APPLIED" -gt 0 ]; then
        echo "  ⏭️  Already applied, skipping"
        ((SKIPPED_COUNT++))
        continue
    fi
    
    # Apply migration
    echo "  📝 Applying migration..."
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f "$MIGRATION_FILE" 2>&1; then
        # Record migration
        PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -c \
            "INSERT INTO schema_migrations (version) VALUES ('$MIGRATION_VERSION');" &>/dev/null
        
        echo "  ✅ Migration applied successfully"
        ((APPLIED_COUNT++))
    else
        echo "  ❌ Migration failed!"
        ((FAILED_COUNT++))
        echo ""
        echo "❌ Migration process failed at: $MIGRATION_NAME"
        exit 1
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

