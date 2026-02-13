# API Tests

## Quick Start

```bash
# Run all tests
bash tests/run_api_tests.sh

# Run unit tests only
npm test

# Run integration tests only
bash tests/api/integration_test.sh
```

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTHOG_API_KEY` | For integration tests | PostHog personal API key |
| `POSTHOG_PROJECT_ID` | Optional | Defaults to 54557 |
| `API_BASE_URL` | Optional | Override deployed URL (default: https://jarvio-posthog-analytics.vercel.app) |

Unit tests mock all external calls and need no env vars.

## Test Files

| File | Type | What it tests |
|------|------|---------------|
| `tests/api/test_refresh.js` | Unit | Response structure, date filtering, org grouping, domain filtering, flow aggregation, error handling |
| `tests/api/test_data.js` | Unit | Cache hit/miss/expiry, refresh fallback, stale cache serving |
| `tests/api/test_time_calculation.js` | Unit | Distinct minute counting, overcounting prevention, daily aggregation, burst vs sparse patterns |
| `tests/api/integration_test.sh` | Integration | Live API calls, response validation, sanity checks (no >12h/day) |
| `tests/run_api_tests.sh` | Runner | Runs all above, exit 0 if all pass |

## CI/CD

```yaml
# GitHub Actions example
- name: Run unit tests
  run: |
    npm install
    npm test

- name: Run integration tests
  if: env.POSTHOG_API_KEY != ''
  env:
    POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
  run: bash tests/api/integration_test.sh
```

Integration tests gracefully skip when `POSTHOG_API_KEY` is not set.

## Coverage

- **api/refresh.js**: Response structure, date ranges (7/14/30/60), active minutes calculation, missing API key, PostHog errors, flow analytics, org grouping, generic domain filtering, CORS, cache write
- **api/data.js**: Fresh cache, stale cache, expired cache, missing cache, refresh fallback, error recovery, CORS
- **Time accuracy**: Distinct minute counting, no overcounting, burst/sparse patterns, multi-day aggregation, per-user independence, daily data preservation
