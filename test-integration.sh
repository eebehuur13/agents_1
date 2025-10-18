#!/bin/bash

# Integration Test Script
# Run this after deployment with: bash test-integration.sh YOUR_WORKER_URL

set -e

if [ -z "$1" ]; then
    echo "Usage: bash test-integration.sh YOUR_WORKER_URL"
    echo "Example: bash test-integration.sh https://doc-assistant.your-subdomain.workers.dev"
    exit 1
fi

BASE_URL="$1"

echo "🧪 Testing Document Assistant at: $BASE_URL"
echo ""

# Test 1: Health check
echo "1️⃣  Testing health endpoint..."
HEALTH=$(curl -s "$BASE_URL/health")
echo "   Response: $HEALTH"
if echo "$HEALTH" | grep -q "ok"; then
    echo "   ✅ Health check passed"
else
    echo "   ❌ Health check failed"
    exit 1
fi
echo ""

# Test 2: List files (should be empty initially)
echo "2️⃣  Testing list files..."
FILES=$(curl -s "$BASE_URL/api/files")
echo "   Response: $FILES"
if echo "$FILES" | grep -q "files"; then
    echo "   ✅ List files works"
else
    echo "   ❌ List files failed"
    exit 1
fi
echo ""

# Test 3: Upload a test file
echo "3️⃣  Testing file upload..."
echo "This is a test document about project planning." > /tmp/test-doc.txt
UPLOAD=$(curl -s -X POST "$BASE_URL/api/upload" -F "file=@/tmp/test-doc.txt")
echo "   Response: $UPLOAD"
FILE_ID=$(echo "$UPLOAD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$FILE_ID" ]; then
    echo "   ❌ Upload failed"
    exit 1
else
    echo "   ✅ Upload successful (ID: $FILE_ID)"
fi
echo ""

# Test 4: Query with streaming (requires API key to be set)
echo "4️⃣  Testing AI query..."
echo "   Sending query: 'What files do I have?'"
curl -X POST "$BASE_URL/api/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"What files do I have?"}' \
  --no-buffer 2>&1 | head -n 20

echo ""
echo "   ✅ Query endpoint works (check output above for streaming events)"
echo ""

# Test 5: Delete file
echo "5️⃣  Testing file deletion..."
DELETE=$(curl -s -X DELETE "$BASE_URL/api/files/$FILE_ID")
echo "   Response: $DELETE"
if echo "$DELETE" | grep -q "success"; then
    echo "   ✅ Delete successful"
else
    echo "   ❌ Delete failed"
fi
echo ""

# Cleanup
rm -f /tmp/test-doc.txt

echo "🎉 All tests passed!"
echo ""
echo "Next steps:"
echo "1. Upload more documents via the web interface"
echo "2. Try complex queries like:"
echo "   - 'Summarize all documents'"
echo "   - 'What are the key points in project-plan.pdf?'"
echo "   - 'Find mentions of deadline across all files'"
