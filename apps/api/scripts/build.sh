#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR%/scripts}"

cd "$PROJECT_ROOT"

rm -rf dist/package
mkdir -p dist/package

# Copy all JS files and directories from dist (preserving structure)
cp -r dist/*.js dist/package/ 2>/dev/null || true
cp -r dist/routes dist/package/ 2>/dev/null || true
cp -r dist/db dist/package/ 2>/dev/null || true
cp -r dist/middleware dist/package/ 2>/dev/null || true
cp -r dist/lib dist/package/ 2>/dev/null || true
cp -r dist/realtime dist/package/ 2>/dev/null || true

cp package.json dist/package/
cd dist/package
npm install --omit=dev

cd ..
# Zip the contents of package/, not package/ itself, so files are at root
cd package
zip -r ../api.zip .
cd ..
rm -rf package

echo "✅ API package created: dist/api.zip"
