#!/usr/bin/env bash
# Integration test - calls real API endpoints
# Requires: POSTHOG_API_KEY in env or ../.env file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env if exists
if [ -f "$ROOT_DIR/.env" ]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
fi

if [ -z "${POSTHOG_API_KEY:-}" ]; then
  echo "SKIP: POSTHOG_API_KEY not set. Set it in env or .env to run integration tests."
  exit 0
fi

# If deployed, use the real URL; otherwise skip endpoint tests
BASE_URL="${API_BASE_URL:-https://jarvio-posthog-analytics.vercel.app}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✅ $name"
    ((PASS++))
  else
    echo "  ❌ $name"
    ((FAIL++))
  fi
}

echo "=== Integration Tests ==="
echo "Target: $BASE_URL"
echo ""

# Test 1: /api/refresh returns valid structure
echo "Test: /api/refresh"
REFRESH_RESP=$(curl -sf "$BASE_URL/api/refresh?days=14" 2>/dev/null || echo "CURL_FAIL")

if [ "$REFRESH_RESP" = "CURL_FAIL" ]; then
  echo "  ⚠️  Cannot reach $BASE_URL - skipping endpoint tests"
  echo ""
  echo "=== Results: SKIPPED (endpoint unreachable) ==="
  exit 0
fi

HAS_ORGS=$(echo "$REFRESH_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(Array.isArray(d.organizations))" 2>/dev/null || echo "false")
check "Response has organizations array" "$HAS_ORGS"

HAS_DATES=$(echo "$REFRESH_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(!!d.startDate && !!d.endDate && !!d.refreshedAt)" 2>/dev/null || echo "false")
check "Response has startDate, endDate, refreshedAt" "$HAS_DATES"

# Test 2: Check theamazonwhisperer.com has reasonable time values
echo ""
echo "Test: theamazonwhisperer.com time values"
WHISP_CHECK=$(echo "$REFRESH_RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const org = d.organizations.find(o => o.name === 'theamazonwhisperer.com');
  if (!org) { console.log('not_found'); process.exit(0); }
  const maxTime = Math.max(...org.users.map(u => u.totalTimeMinutes));
  // 14 days * 12h * 60min = 10080 max reasonable
  console.log(maxTime > 0 && maxTime < 10080);
" 2>/dev/null || echo "false")

if [ "$WHISP_CHECK" = "not_found" ]; then
  echo "  ⚠️  theamazonwhisperer.com not found in data (may not have activity)"
else
  check "theamazonwhisperer.com has reasonable time" "$WHISP_CHECK"
fi

# Test 3: No user shows >12h/day average
echo ""
echo "Test: No user exceeds 12h/day average"
SANITY=$(echo "$REFRESH_RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const start = new Date(d.startDate);
  const end = new Date(d.endDate);
  const days = Math.max(1, (end - start) / (1000*60*60*24));
  let allOk = true;
  for (const org of d.organizations) {
    for (const u of org.users) {
      const avgPerDay = u.totalTimeMinutes / days;
      if (avgPerDay > 720) { // 12h = 720min
        console.error('EXCESSIVE:', u.email, avgPerDay, 'min/day');
        allOk = false;
      }
    }
  }
  console.log(allOk);
" 2>/dev/null || echo "false")
check "No user exceeds 12h/day average" "$SANITY"

# Test 4: /api/data returns same format
echo ""
echo "Test: /api/data"
DATA_RESP=$(curl -sf "$BASE_URL/api/data" 2>/dev/null || echo "CURL_FAIL")

if [ "$DATA_RESP" != "CURL_FAIL" ]; then
  DATA_HAS_ORGS=$(echo "$DATA_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(Array.isArray(d.organizations))" 2>/dev/null || echo "false")
  check "/api/data has organizations array" "$DATA_HAS_ORGS"

  DATA_HAS_DATES=$(echo "$DATA_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(!!d.startDate && !!d.endDate)" 2>/dev/null || echo "false")
  check "/api/data has date fields" "$DATA_HAS_DATES"
else
  echo "  ⚠️  /api/data unreachable"
fi

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
