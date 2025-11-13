#!/bin/bash
# Apply database migrations via Lambda function (for RDS in private subnet)
# This script reads migration files and executes them through the Lambda API
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

# Source environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env.sh"

MIGRATIONS_DIR="${PROJECT_ROOT}/apps/api/migrations"
API_ENDPOINT="https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod"

echo "🔄 Running database migrations via Lambda for StenoAI"
echo "======================================================"
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
echo "🔌 Testing Lambda database connection..."
if ! curl -s "$API_ENDPOINT/health/db" | jq -e '.db == "ok"' > /dev/null; then
    echo "❌ Error: Lambda cannot connect to database"
    echo "   Check Lambda logs and VPC configuration"
    exit 1
fi

echo "  ✅ Lambda can connect to database"
echo ""

# Note: This approach requires a migration endpoint in the Lambda
# For now, we'll use a direct approach by creating a Node.js script
echo "⚠️  Note: Direct Lambda migration execution requires a migration endpoint."
echo "   Using alternative approach: Node.js migration runner"
echo ""

# Create temporary migration runner script
TEMP_SCRIPT="/tmp/run_migration.js"
cat > "$TEMP_SCRIPT" << 'NODE_EOF'
const { Pool } = require('pg');
const fs = require('fs');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function runMigration() {
  const region = process.env.REGION || 'us-east-1';
  const env = process.env.ENV || 'dev';
  const secretName = `/stenoai/${env}/db`;
  const migrationFile = process.argv[2];
  
  if (!migrationFile) {
    console.error('Usage: node run_migration.js <migration_file.sql>');
    process.exit(1);
  }
  
  // Fetch credentials
  const secretsClient = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await secretsClient.send(command);
  const credentials = JSON.parse(response.SecretString);
  
  // Create connection pool
  const pool = new Pool({
    host: credentials.PGHOST,
    database: credentials.PGDATABASE,
    user: credentials.PGUSER,
    password: credentials.PGPASSWORD,
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    // Read and execute migration
    const sql = fs.readFileSync(migrationFile, 'utf8');
    await pool.query(sql);
    console.log('✅ Migration applied successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
NODE_EOF

echo "📝 Created temporary migration runner"
echo ""

# Note: This Node.js approach also requires VPC access
echo "⚠️  This approach still requires VPC access."
echo ""
echo "💡 Recommended: Use AWS Systems Manager Session Manager port forwarding"
echo "   or add a migration endpoint to the Lambda function."
echo ""
echo "For now, please ensure you have:"
echo "  1. SSM port forwarding set up, OR"
echo "  2. A bastion host in the VPC, OR"  
echo "  3. VPN connection to the VPC"
echo ""
echo "Then run: bash scripts/migrate.sh"
echo ""

