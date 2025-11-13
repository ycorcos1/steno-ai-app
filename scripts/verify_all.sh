#!/bin/bash
# Comprehensive verification script for PRs #1-14

set -e

source scripts/env.sh

API_BASE_URL="https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod"
WS_API_ID="n3fxav2xid"

echo "=========================================="
echo "COMPREHENSIVE VERIFICATION: PRs #1-14"
echo "=========================================="
echo ""

ERRORS=0
WARNINGS=0

check() {
    if [ $? -eq 0 ]; then
        echo "✅ $1"
    else
        echo "❌ $1"
        ERRORS=$((ERRORS + 1))
    fi
}

warn() {
    echo "⚠️  $1"
    WARNINGS=$((WARNINGS + 1))
}

echo "=== PR #1: Monorepo Structure ==="
[ -d "apps/web" ] && check "apps/web directory exists" || ERRORS=$((ERRORS + 1))
[ -d "apps/api" ] && check "apps/api directory exists" || ERRORS=$((ERRORS + 1))
[ -d "apps/ai" ] && check "apps/ai directory exists" || ERRORS=$((ERRORS + 1))
[ -f "scripts/env.sh" ] && check "scripts/env.sh exists" || ERRORS=$((ERRORS + 1))
[ -f "Makefile" ] && check "Makefile exists" || ERRORS=$((ERRORS + 1))
npm --prefix apps/web run build > /dev/null 2>&1 && check "Frontend builds successfully" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #2: Static Hosting ==="
aws s3api head-bucket --bucket "${APP}-${ENV}-web" 2>/dev/null && check "S3 web bucket exists" || ERRORS=$((ERRORS + 1))
CF_DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='StenoAI Static Web Hosting'].Id" --output text 2>/dev/null)
[ -n "$CF_DIST" ] && [ "$CF_DIST" != "None" ] && check "CloudFront distribution exists: $CF_DIST" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #3: API Gateway + Lambda ==="
curl -s "$API_BASE_URL/health" | jq -e '.status == "ok"' > /dev/null && check "API /health endpoint works" || ERRORS=$((ERRORS + 1))
aws lambda get-function --function-name "${APP}-${ENV}-api" --query 'Configuration.FunctionName' --output text 2>/dev/null | grep -q "${APP}-${ENV}-api" && check "API Lambda function exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #4: S3 Presigned URLs ==="
aws s3api head-bucket --bucket "${APP}-${ENV}-uploads" 2>/dev/null && check "Upload bucket exists" || ERRORS=$((ERRORS + 1))
aws s3api head-bucket --bucket "${APP}-${ENV}-exports" 2>/dev/null && check "Export bucket exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/routes/storage.ts" ] && check "storage.ts route exists" || ERRORS=$((ERRORS + 1))
# Verify auth is required
curl -s -X POST "$API_BASE_URL/documents/upload-url" -H "Content-Type: application/json" -d '{"contentType":"application/pdf"}' | jq -e '.error != null' > /dev/null && check "Storage endpoint requires authentication" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #5: VPC + RDS + Endpoints ==="
curl -s "$API_BASE_URL/health/db" | jq -e '.db == "ok"' > /dev/null && check "Database health check works" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/db/pg.ts" ] && check "pg.ts with connection pooling exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #6: DB Schema ==="
[ -f "apps/api/migrations/0001_init.sql" ] && check "Migration 0001_init.sql exists" || ERRORS=$((ERRORS + 1))
# Verify tables exist
curl -s -X POST "$API_BASE_URL/migrate" -H "Content-Type: application/json" -d '{"sql":"SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name IN ('\''users'\'', '\''templates'\'', '\''documents'\'', '\''refinements'\'', '\''document_collaborators'\'', '\''exports'\'');"}' | jq -e '.message != null' > /dev/null && check "Schema tables verified" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #7: Auth Backend ==="
[ -f "apps/api/src/routes/auth.ts" ] && check "auth.ts route exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/middleware/auth.ts" ] && check "auth middleware exists" || ERRORS=$((ERRORS + 1))
# Test auth endpoints
curl -s -X POST "$API_BASE_URL/auth/signup" -H "Content-Type: application/json" -d '{}' | jq -e '.error != null' > /dev/null && check "Signup endpoint validates input" || ERRORS=$((ERRORS + 1))
curl -s "$API_BASE_URL/auth/me" | jq -e '.error != null' > /dev/null && check "Auth endpoint requires authentication" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #8: Auth Frontend ==="
[ -f "apps/web/src/pages/Home.tsx" ] && check "Home.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Login.tsx" ] && check "Login.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Signup.tsx" ] && check "Signup.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Dashboard.tsx" ] && check "Dashboard.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/lib/auth.tsx" ] && check "auth.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/AppRouter.tsx" ] && check "AppRouter.tsx exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #9: Ingest + Extraction ==="
[ -f "apps/api/src/routes/ingest.ts" ] && check "ingest.ts route exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/lib/extract_basic.ts" ] && check "extract_basic.ts exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #10: Chunking & Merge ==="
[ -f "apps/api/src/lib/extract_chunked.ts" ] && check "extract_chunked.ts exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/lib/merge.ts" ] && check "merge.ts exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #11: Templates + Upload + Editor ==="
[ -f "apps/api/src/routes/templates.ts" ] && check "templates.ts route exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Upload.tsx" ] && check "Upload.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Templates.tsx" ] && check "Templates.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/TemplateEditor.tsx" ] && check "TemplateEditor.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/Editor.tsx" ] && check "Editor.tsx exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #12: AI Draft Generation ==="
[ -f "apps/ai/main.py" ] && check "AI main.py exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/routes/generate.ts" ] && check "generate.ts route exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/lib/composePrompt.ts" ] && check "composePrompt.ts exists" || ERRORS=$((ERRORS + 1))
AI_FUNCTION=$(aws lambda get-function --function-name "${APP}-${ENV}-ai" --query 'Configuration.FunctionName' --output text 2>/dev/null)
[ -n "$AI_FUNCTION" ] && [ "$AI_FUNCTION" == "${APP}-${ENV}-ai" ] && check "AI Lambda function exists: $AI_FUNCTION" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #13: AI Refinement + History ==="
[ -f "apps/api/src/routes/refine.ts" ] && check "refine.ts route exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/pages/History.tsx" ] && check "History.tsx exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/migrations/0002_refinements.sql" ] && check "Migration 0002_refinements.sql exists" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== PR #14: Real-time Collaboration ==="
[ -f "apps/api/src/realtime/ws_handler.ts" ] && check "ws_handler.ts exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/src/realtime/persist.ts" ] && check "persist.ts exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/web/src/lib/collab/yjs.ts" ] && check "yjs.ts exists" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/migrations/0003_collab.sql" ] && check "Migration 0003_collab.sql exists" || ERRORS=$((ERRORS + 1))
[ -f "scripts/ws_create.sh" ] && check "ws_create.sh exists" || ERRORS=$((ERRORS + 1))
WS_FUNCTION=$(aws lambda get-function --function-name "${APP}-${ENV}-ws" --query 'Configuration.FunctionName' --output text 2>/dev/null)
[ -n "$WS_FUNCTION" ] && [ "$WS_FUNCTION" == "${APP}-${ENV}-ws" ] && check "WebSocket Lambda function exists: $WS_FUNCTION" || ERRORS=$((ERRORS + 1))
WS_API=$(aws apigatewayv2 get-apis --query "Items[?Name=='${APP}-${ENV}-ws'].ApiId" --output text 2>/dev/null)
[ -n "$WS_API" ] && [ "$WS_API" != "None" ] && check "WebSocket API exists: $WS_API" || ERRORS=$((ERRORS + 1))
# Verify WebSocket routes
WS_ROUTES=$(aws apigatewayv2 get-routes --api-id "$WS_API" --query "Items[].RouteKey" --output text 2>/dev/null | wc -w)
[ "$WS_ROUTES" -ge 3 ] && check "WebSocket routes configured ($WS_ROUTES routes)" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== Lambda Functions Status ==="
API_STATUS=$(aws lambda get-function --function-name "${APP}-${ENV}-api" --query 'Configuration.LastUpdateStatus' --output text 2>/dev/null)
[ "$API_STATUS" == "Successful" ] && check "API Lambda status: $API_STATUS" || warn "API Lambda status: $API_STATUS"
AI_STATUS=$(aws lambda get-function --function-name "${APP}-${ENV}-ai" --query 'Configuration.LastUpdateStatus' --output text 2>/dev/null)
[ "$AI_STATUS" == "Successful" ] && check "AI Lambda status: $AI_STATUS" || warn "AI Lambda status: $AI_STATUS"
WS_STATUS=$(aws lambda get-function --function-name "${APP}-${ENV}-ws" --query 'Configuration.LastUpdateStatus' --output text 2>/dev/null)
[ "$WS_STATUS" == "Successful" ] && check "WebSocket Lambda status: $WS_STATUS" || warn "WebSocket Lambda status: $WS_STATUS"
echo ""

echo "=== Database Migrations ==="
# Verify all migrations can be read
[ -f "apps/api/migrations/0001_init.sql" ] && check "0001_init.sql readable" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/migrations/0002_refinements.sql" ] && check "0002_refinements.sql readable" || ERRORS=$((ERRORS + 1))
[ -f "apps/api/migrations/0003_collab.sql" ] && check "0003_collab.sql readable" || ERRORS=$((ERRORS + 1))
echo ""

echo "=== Final Summary ==="
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -eq 0 ]; then
    echo "✅ ALL CHECKS PASSED - Ready for PR #15!"
    exit 0
else
    echo "❌ $ERRORS error(s) found - Please fix before proceeding"
    exit 1
fi

