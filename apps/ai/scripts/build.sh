#!/bin/bash
# Build script for AI Lambda function
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$AI_DIR/../.." && pwd)"
ZIP_FILE="${PROJECT_ROOT}/apps/ai/ai.zip"

echo "📦 Building AI Lambda package..."
echo "=================================="

# Change to AI directory
cd "$AI_DIR"

# Remove old zip if it exists
if [ -f "$ZIP_FILE" ]; then
    rm "$ZIP_FILE"
    echo "  Removed old package"
fi

# Create a temporary directory for packaging
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy source files
cp main.py "$TEMP_DIR/"

# Install dependencies to temp directory
echo "  Installing dependencies for Linux (Lambda)..."
# Use --platform to force Linux-compatible builds, and --only-binary to avoid compilation
# This ensures packages work on Lambda's Amazon Linux environment
if command -v pip3 &> /dev/null; then
    pip3 install \
        --platform manylinux2014_x86_64 \
        --target "$TEMP_DIR" \
        --implementation cp \
        --python-version 3.10 \
        --only-binary=:all: \
        --upgrade \
        -r requirements.txt 2>&1 | grep -v "WARNING: Ignoring" || {
        # Fallback: try without platform flag if it fails
        echo "  Platform-specific install failed, trying standard install..."
        pip3 install -r requirements.txt -t "$TEMP_DIR" --quiet
    }
elif command -v pip &> /dev/null; then
    pip install \
        --platform manylinux2014_x86_64 \
        --target "$TEMP_DIR" \
        --implementation cp \
        --python-version 3.10 \
        --only-binary=:all: \
        --upgrade \
        -r requirements.txt 2>&1 | grep -v "WARNING: Ignoring" || {
        echo "  Platform-specific install failed, trying standard install..."
        pip install -r requirements.txt -t "$TEMP_DIR" --quiet
    }
else
    echo "  ❌ Error: pip or pip3 not found"
    exit 1
fi

# Create zip file
echo "  Creating zip package..."
cd "$TEMP_DIR"
zip -r "$ZIP_FILE" . -q

# Get package size
PACKAGE_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo "  ✅ Package created: $ZIP_FILE ($PACKAGE_SIZE)"

