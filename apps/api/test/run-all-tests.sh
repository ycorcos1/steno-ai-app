#!/bin/bash
# Run all tests (unit + integration) against deployed API
# 
# Usage:
#   export API_BASE_URL="https://your-api.execute-api.region.amazonaws.com/prod"
#   export TEST_EMAIL="test@example.com"
#   export TEST_PASSWORD="password123"
#   bash test/run-all-tests.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Source environment
if [ -f "../../scripts/env.sh" ]; then
  source ../../scripts/env.sh
fi

API_BASE_URL="${API_BASE_URL:-https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod}"
TEST_EMAIL="${TEST_EMAIL:-test@stenoai.com}"
TEST_PASSWORD="${TEST_PASSWORD:-testpass123}"

echo "=========================================="
echo "COMPREHENSIVE TEST SUITE"
echo "=========================================="
echo "API: $API_BASE_URL"
echo "Timestamp: $(date)"
echo ""

# Track test results
UNIT_TEST_EXIT=0
INTEGRATION_TEST_EXIT=0

# Get auth token
echo "🔐 Getting authentication token..."
if [ -f "test/get-auth-token.sh" ]; then
  export API_BASE_URL
  export TEST_EMAIL
  export TEST_PASSWORD
  source <(bash test/get-auth-token.sh 2>&1 | grep "^export")
else
  echo "❌ get-auth-token.sh not found"
  exit 1
fi

if [ -z "$TEST_AUTH_TOKEN" ]; then
  echo "❌ Failed to get auth token"
  exit 1
fi

echo "✅ Auth token obtained"
echo ""

# Run unit tests
echo "🧪 Running Unit Tests..."
echo "----------------------------------------"
if npm test -- --testPathIgnorePatterns=integration --coverage --coverageReporters=text-summary 2>&1 | tee /tmp/unit-test-output.log; then
  echo "✅ Unit tests passed"
else
  UNIT_TEST_EXIT=$?
  echo "❌ Unit tests failed with exit code $UNIT_TEST_EXIT"
fi

echo ""
echo "📊 Unit Test Summary:"
echo "----------------------------------------"
tail -20 /tmp/unit-test-output.log | grep -E "(Tests:|PASS|FAIL|Coverage)" || echo "No summary available"

echo ""
echo "🧪 Running Integration Tests..."
echo "----------------------------------------"
export TEST_AUTH_TOKEN
export API_BASE_URL
export REGION="${REGION:-us-east-1}"
export ENV="${ENV:-dev}"
export APP="${APP:-stenoai}"

if npm test -- integration 2>&1 | tee /tmp/integration-test-output.log; then
  echo "✅ Integration tests passed"
else
  INTEGRATION_TEST_EXIT=$?
  echo "❌ Integration tests failed with exit code $INTEGRATION_TEST_EXIT"
fi

echo ""
echo "📊 Integration Test Summary:"
echo "----------------------------------------"
tail -30 /tmp/integration-test-output.log | grep -E "(Tests:|PASS|FAIL|✓|✗)" || echo "No summary available"

echo ""
echo "=========================================="
if [ $UNIT_TEST_EXIT -eq 0 ] && [ $INTEGRATION_TEST_EXIT -eq 0 ]; then
  echo "✅ All tests passed!"
  echo "=========================================="
  exit 0
else
  echo "❌ Some tests failed"
  echo "  Unit tests: $([ $UNIT_TEST_EXIT -eq 0 ] && echo 'PASS' || echo 'FAIL')"
  echo "  Integration tests: $([ $INTEGRATION_TEST_EXIT -eq 0 ] && echo 'PASS' || echo 'FAIL')"
  echo "=========================================="
  exit 1
fi

