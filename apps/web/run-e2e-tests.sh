#!/bin/bash
# E2E test runner with timeout protection
set -e

WEB_BASE_URL="${WEB_BASE_URL:-https://d2m2ob9ztbwghm.cloudfront.net}"
API_BASE_URL="${API_BASE_URL:-https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod}"
MAX_TIME="${MAX_TIME:-120}" # 2 minutes max

export WEB_BASE_URL
export API_BASE_URL

echo "=== Running E2E Tests ==="
echo "WEB_BASE_URL: $WEB_BASE_URL"
echo "API_BASE_URL: $API_BASE_URL"
echo "Max time: ${MAX_TIME}s"
echo ""

# Run Playwright in background and capture PID
npx playwright test --project=chromium --workers=1 --reporter=list "$@" &
PLAYWRIGHT_PID=$!

# Function to cleanup
cleanup() {
  echo ""
  echo "Cleaning up..."
  kill $PLAYWRIGHT_PID 2>/dev/null || true
  pkill -f "playwright" 2>/dev/null || true
  pkill -f "chromium" 2>/dev/null || true
  exit 0
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Wait for process with timeout
START_TIME=$(date +%s)
while kill -0 $PLAYWRIGHT_PID 2>/dev/null; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  
  if [ $ELAPSED -ge $MAX_TIME ]; then
    echo ""
    echo "⏱️  Timeout after ${MAX_TIME}s - killing Playwright"
    cleanup
    exit 1
  fi
  
  sleep 1
done

# Wait for process to finish
wait $PLAYWRIGHT_PID
EXIT_CODE=$?

echo ""
echo "Tests completed with exit code: $EXIT_CODE"
exit $EXIT_CODE

