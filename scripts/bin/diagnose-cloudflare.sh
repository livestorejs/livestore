#!/usr/bin/env bash

# Cloudflare Wrangler Diagnostic Script
# This script tests various Cloudflare API operations to diagnose deployment issues
# Usage: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx ./diagnose-cloudflare.sh

set +e  # Continue on errors to collect all diagnostic data

echo "=========================================="
echo "Cloudflare Wrangler Diagnostic Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}"
    else
        echo -e "${RED}✗ FAIL (exit code: $1)${NC}"
    fi
}

section() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
}

# Check prerequisites
section "1. Environment Check"
echo "Checking required environment variables..."
echo -n "CLOUDFLARE_API_TOKEN: "
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${RED}NOT SET${NC}"
else
    echo -e "${GREEN}SET (length: ${#CLOUDFLARE_API_TOKEN})${NC}"
fi

echo -n "CLOUDFLARE_ACCOUNT_ID: "
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}NOT SET${NC}"
else
    echo -e "${GREEN}SET ($CLOUDFLARE_ACCOUNT_ID)${NC}"
fi

echo ""
echo "Wrangler version:"
bunx wrangler --version

# Test 1: Whoami
section "2. Authentication Test (whoami)"
echo "Testing authentication with 'wrangler whoami'..."
bunx wrangler whoami 2>&1
RESULT=$?
test_result $RESULT

# Test 2: List workers/services
section "3. List Workers/Services"
echo "Attempting to list existing workers..."
bunx wrangler deployments list 2>&1 | head -50
RESULT=$?
test_result $RESULT

# Test 3: Check specific service
section "4. Check Target Service (example-cf-chat-preview)"
echo "Checking if target service 'example-cf-chat-preview' exists..."
bunx wrangler deployments list --name example-cf-chat-preview 2>&1 | head -20
RESULT=$?
test_result $RESULT

# Test 4: Try to get service info via API
section "5. Direct API Test - List Workers"
echo "Testing direct API call to list workers..."
curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/services" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.' 2>&1 | head -50
RESULT=$?
test_result $RESULT

# Test 5: Get account info
section "6. Direct API Test - Account Info"
echo "Testing direct API call to get account info..."
curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
RESULT=$?
test_result $RESULT

# Test 6: Try to access specific service via API
section "7. Direct API Test - Get Specific Service"
echo "Testing direct API call to get example-cf-chat-preview service..."
curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/services/example-cf-chat-preview" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
RESULT=$?
test_result $RESULT

# Test 7: Create a minimal test worker
section "8. Create Minimal Test Worker"
echo "Creating a minimal test worker for deployment test..."

TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

# Create minimal worker
cat > worker.js << 'EOF'
export default {
  async fetch(request) {
    return new Response('Hello from diagnostic test worker!');
  }
};
EOF

# Create wrangler.toml without account_id
cat > wrangler.toml << EOF
name = "diagnostic-test-worker-$(date +%s)"
main = "worker.js"
compatibility_date = "2024-01-01"
EOF

echo ""
echo "Test worker files created:"
ls -la
echo ""
echo "wrangler.toml content:"
cat wrangler.toml
echo ""
echo "worker.js content:"
cat worker.js
echo ""

echo "Attempting to deploy minimal test worker (with account_id from env)..."
bunx wrangler deploy 2>&1
RESULT=$?
test_result $RESULT

# Test 8: Try deploy with explicit account_id
section "9. Deploy Test Worker with Explicit account_id"
echo "Adding account_id to wrangler.toml..."
cat > wrangler.toml << EOF
name = "diagnostic-test-worker-explicit-$(date +%s)"
account_id = "${CLOUDFLARE_ACCOUNT_ID}"
main = "worker.js"
compatibility_date = "2024-01-01"
EOF

echo "Updated wrangler.toml:"
cat wrangler.toml
echo ""

echo "Attempting to deploy with explicit account_id..."
bunx wrangler deploy 2>&1
RESULT=$?
test_result $RESULT

# Test 9: Try to deploy to existing service
section "10. Deploy to Existing Service (example-cf-chat-preview)"
echo "Attempting to deploy minimal worker to existing service..."
cat > wrangler.toml << EOF
name = "example-cf-chat-preview"
main = "worker.js"
compatibility_date = "2024-01-01"
EOF

echo "wrangler.toml for existing service:"
cat wrangler.toml
echo ""

echo "Attempting deployment..."
bunx wrangler deploy --dry-run 2>&1
RESULT=$?
echo "Dry-run result:"
test_result $RESULT

echo ""
echo "Attempting actual deployment..."
bunx wrangler deploy 2>&1
RESULT=$?
test_result $RESULT

# Test 10: Network connectivity test
section "11. Network Connectivity Tests"
echo "Testing connectivity to Cloudflare API endpoints..."

echo ""
echo "Testing api.cloudflare.com..."
curl -v https://api.cloudflare.com 2>&1 | head -30
RESULT=$?
test_result $RESULT

echo ""
echo "DNS resolution for api.cloudflare.com..."
nslookup api.cloudflare.com 2>&1 || dig api.cloudflare.com 2>&1 || host api.cloudflare.com 2>&1

echo ""
echo "Traceroute to api.cloudflare.com (first 10 hops)..."
traceroute -m 10 api.cloudflare.com 2>&1 || echo "traceroute not available"

# Test 11: Check wrangler cache
section "12. Wrangler Cache Inspection"
echo "Checking wrangler cache directories..."

if [ -d "$HOME/.wrangler" ]; then
    echo "~/.wrangler exists:"
    ls -la "$HOME/.wrangler" 2>&1 || echo "Cannot list"

    if [ -f "$HOME/.wrangler/config/default.toml" ]; then
        echo ""
        echo "Wrangler config:"
        cat "$HOME/.wrangler/config/default.toml" 2>&1
    fi
fi

if [ -d "$HOME/.config/.wrangler" ]; then
    echo ""
    echo "~/.config/.wrangler exists:"
    find "$HOME/.config/.wrangler" -type f 2>&1 | head -20
fi

# Test 12: Environment variable visibility
section "13. Environment Variables in Wrangler Context"
echo "Checking if wrangler sees the environment variables..."
bunx wrangler deploy --help 2>&1 | grep -i "account\|environment" | head -10

# Cleanup
cd /
rm -rf "$TEST_DIR"

# Summary
section "DIAGNOSTIC SUMMARY"
echo "Diagnostic script completed."
echo ""
echo "Key findings to review:"
echo "1. Authentication status (whoami)"
echo "2. Whether services list successfully"
echo "3. Whether the target service is accessible"
echo "4. Direct API call results vs wrangler CLI"
echo "5. Whether new worker creation works"
echo "6. Network connectivity to Cloudflare"
echo "7. Wrangler cache state"
echo ""
echo "Review the output above for any patterns in failures."
echo "=========================================="
