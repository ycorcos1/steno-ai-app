#!/bin/bash
# Manual integration test script for PR #9 - Ingest + Basic Extraction
# 
# Prerequisites:
# - API deployed and accessible
# - Valid AWS credentials configured
# - Test user account created
# - S3 upload bucket exists
#
# Usage:
#   export API_BASE_URL="https://your-api.execute-api.region.amazonaws.com/prod"
#   export TEST_EMAIL="test@example.com"
#   export TEST_PASSWORD="password123"
#   bash test/manual-test.sh

set -e

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-test@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-password123}"

echo "🧪 Testing PR #9 - Ingest + Basic Extraction"
echo "API Base URL: $API_BASE_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Login to get auth token
echo "📝 Test 1: Login"
LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
  -c /tmp/stenoai_cookies.txt)

if echo "$LOGIN_RESPONSE" | grep -q "Login successful\|token\|auth_token"; then
  echo -e "${GREEN}✅ Login successful${NC}"
  AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4 || echo "")
  # Cookie is automatically saved by curl -c flag
else
  echo -e "${RED}❌ Login failed${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

# Test 2: Get upload URL
echo ""
echo "📝 Test 2: Get presigned upload URL"
UPLOAD_URL_RESPONSE=$(curl -s -X POST "$API_BASE_URL/documents/upload-url" \
  -H "Content-Type: application/json" \
  -b /tmp/stenoai_cookies.txt \
  -d '{"contentType":"text/plain","fileName":"test-document.txt"}')

UPLOAD_URL=$(echo "$UPLOAD_URL_RESPONSE" | grep -o '"uploadUrl":"[^"]*' | cut -d'"' -f4)
S3_KEY=$(echo "$UPLOAD_URL_RESPONSE" | grep -o '"key":"[^"]*' | cut -d'"' -f4)

if [ -z "$UPLOAD_URL" ] || [ -z "$S3_KEY" ]; then
  echo -e "${RED}❌ Failed to get upload URL${NC}"
  echo "Response: $UPLOAD_URL_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Got upload URL${NC}"
echo "  S3 Key: $S3_KEY"

# Test 3: Upload test file to S3
echo ""
echo "📝 Test 3: Upload test file to S3"
TEST_CONTENT="This is a test document for ingestion. It contains some sample text that should be extracted and stored in the database."
echo "$TEST_CONTENT" > /tmp/test-document.txt

UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$UPLOAD_URL" \
  -H "Content-Type: text/plain" \
  --data-binary @/tmp/test-document.txt)

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
  echo -e "${GREEN}✅ File uploaded successfully${NC}"
else
  echo -e "${RED}❌ File upload failed (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

# Test 4: Ingest the file
echo ""
echo "📝 Test 4: Ingest uploaded file"
INGEST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -b /tmp/stenoai_cookies.txt \
  -d "{
    \"key\": \"$S3_KEY\",
    \"originalName\": \"test-document.txt\",
    \"mime\": \"text/plain\",
    \"size\": $(stat -f%z /tmp/test-document.txt 2>/dev/null || stat -c%s /tmp/test-document.txt 2>/dev/null || echo 100)
  }")

HTTP_CODE=$(echo "$INGEST_RESPONSE" | tail -n1)
INGEST_BODY=$(echo "$INGEST_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo -e "${GREEN}✅ Ingestion successful${NC}"
  echo "Response: $INGEST_BODY"
  
  DOCUMENT_ID=$(echo "$INGEST_BODY" | grep -o '"documentId":"[^"]*' | cut -d'"' -f4)
  EXTRACTED_LENGTH=$(echo "$INGEST_BODY" | grep -o '"extractedLength":[0-9]*' | cut -d':' -f2)
  
  if [ -n "$DOCUMENT_ID" ]; then
    echo "  Document ID: $DOCUMENT_ID"
    echo "  Extracted Length: $EXTRACTED_LENGTH"
    echo -e "${GREEN}✅ All tests passed!${NC}"
  else
    echo -e "${YELLOW}⚠️  Could not parse document ID from response${NC}"
  fi
else
  echo -e "${RED}❌ Ingestion failed (HTTP $HTTP_CODE)${NC}"
  echo "Response: $INGEST_BODY"
  exit 1
fi

# Test 5: Verify authentication required
echo ""
echo "📝 Test 5: Verify authentication required"
AUTH_TEST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -d '{"key":"test","originalName":"test.txt","mime":"text/plain","size":100}')

AUTH_HTTP_CODE=$(echo "$AUTH_TEST_RESPONSE" | tail -n1)
if [ "$AUTH_HTTP_CODE" = "401" ]; then
  echo -e "${GREEN}✅ Authentication check passed${NC}"
else
  echo -e "${RED}❌ Authentication check failed (expected 401, got $AUTH_HTTP_CODE)${NC}"
fi

# Test 6: Verify validation
echo ""
echo "📝 Test 6: Verify input validation"
VALIDATION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -b /tmp/stenoai_cookies.txt \
  -d '{"key":"test"}')

VALIDATION_HTTP_CODE=$(echo "$VALIDATION_RESPONSE" | tail -n1)
if [ "$VALIDATION_HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Validation check passed${NC}"
else
  echo -e "${RED}❌ Validation check failed (expected 400, got $VALIDATION_HTTP_CODE)${NC}"
fi

# Cleanup
rm -f /tmp/test-document.txt /tmp/stenoai_cookies.txt

echo ""
echo -e "${GREEN}🎉 All manual tests completed!${NC}"

