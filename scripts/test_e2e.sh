#!/bin/bash
# Run end-to-end tests against deployed environment
#
# Usage:
#   export WEB_BASE_URL="https://your-cloudfront.cloudfront.net"
#   export API_BASE_URL="https://your-api.execute-api.region.amazonaws.com/prod"
#   bash scripts/test_e2e.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../apps/web"

# Source environment if available
if [ -f "../../scripts/env.sh" ]; then
  source ../../scripts/env.sh
fi

WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:5173}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"

echo "=========================================="
echo "E2E TEST SUITE"
echo "=========================================="
echo "Web: $WEB_BASE_URL"
echo "API: $API_BASE_URL"
echo ""

# Check if Playwright is installed
if ! command -v npx &> /dev/null; then
  echo "❌ npx not found. Please install Node.js and npm."
  exit 1
fi

# Install Playwright browsers if needed
if [ ! -d "node_modules/@playwright" ]; then
  echo "📦 Installing Playwright..."
  npm install --save-dev @playwright/test
  npx playwright install --with-deps chromium firefox webkit || {
    echo "⚠️  Playwright browser installation had issues, but continuing..."
  }
fi

# Run E2E tests
echo "🎭 Running Playwright E2E tests..."
export WEB_BASE_URL
export API_BASE_URL

# Run tests with appropriate reporter
if [ -n "$CI" ]; then
  # CI mode: use list reporter
  npx playwright test --reporter=list
else
  # Local mode: use HTML reporter
  npx playwright test
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "✅ E2E tests passed!"
  if [ -z "$CI" ]; then
    echo "📊 View report: npx playwright show-report"
  fi
else
  echo ""
  echo "❌ E2E tests failed with exit code $EXIT_CODE"
  if [ -z "$CI" ]; then
    echo "📊 View report: npx playwright show-report"
  fi
fi

exit $EXIT_CODE

