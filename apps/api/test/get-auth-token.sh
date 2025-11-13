#!/bin/bash
# Get authentication token for integration tests
# This script logs in and extracts the JWT token from the httpOnly cookie

set -e

API_BASE_URL="${API_BASE_URL:-https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod}"
TEST_EMAIL="${TEST_EMAIL:-test@stenoai.com}"
TEST_PASSWORD="${TEST_PASSWORD:-testpass123}"

echo "🔐 Getting authentication token..."
echo "API: $API_BASE_URL"
echo "Email: $TEST_EMAIL"
echo ""

# Try to login and get token
COOKIE_FILE=$(mktemp)
LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
  -c "$COOKIE_FILE" \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -n1)
BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Login failed (HTTP $HTTP_CODE)"
  echo "Response: $BODY"
  echo ""
  echo "💡 Try creating a test user first:"
  echo "   curl -X POST $API_BASE_URL/auth/signup \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}'"
  rm -f "$COOKIE_FILE"
  exit 1
fi

# Extract token from cookie file
AUTH_TOKEN=$(grep -i "auth_token" "$COOKIE_FILE" | awk '{print $7}' | head -n1)

if [ -z "$AUTH_TOKEN" ]; then
  echo "❌ Could not extract auth token from cookie"
  echo "Cookie file contents:"
  cat "$COOKIE_FILE"
  rm -f "$COOKIE_FILE"
  exit 1
fi

echo "✅ Authentication successful"
echo "Token: ${AUTH_TOKEN:0:20}..."
echo ""
echo "Export this token to run integration tests:"
echo "export TEST_AUTH_TOKEN=\"$AUTH_TOKEN\""
echo "export API_BASE_URL=\"$API_BASE_URL\""
echo ""

# Export for immediate use
export TEST_AUTH_TOKEN="$AUTH_TOKEN"
export API_BASE_URL="$API_BASE_URL"

rm -f "$COOKIE_FILE"

