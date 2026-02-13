#!/usr/bin/env bash
# Run all API tests (unit + integration)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Load .env if exists
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

PASS=0
FAIL=0

run_section() {
  local name="$1"
  shift
  echo ""
  echo "━━━ $name ━━━"
  if "$@"; then
    echo "✅ $name PASSED"
    ((PASS++))
  else
    echo "❌ $name FAILED"
    ((FAIL++))
  fi
}

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --silent
fi

# Unit tests
run_section "Unit: refresh.js" npx jest tests/api/test_refresh.js --forceExit --no-coverage
run_section "Unit: data.js" npx jest tests/api/test_data.js --forceExit --no-coverage
run_section "Unit: time_calculation.js" npx jest tests/api/test_time_calculation.js --forceExit --no-coverage

# Integration tests
run_section "Integration tests" bash tests/api/integration_test.sh

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
