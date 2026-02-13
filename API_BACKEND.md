# API Backend Documentation

## Architecture

The dashboard supports two data modes:
1. **Embedded data** — Static JSON baked into `index.html` (original behavior, always works)
2. **Live API** — Vercel serverless functions that fetch from PostHog in real-time

The frontend tries the API first, falls back to embedded data if it fails.

## API Endpoints

### `GET /api/data`
Returns the latest dashboard data. Uses a 1-hour server-side cache.

**Response:**
```json
{
  "organizations": [...],
  "startDate": "2025-12-14",
  "endDate": "2026-02-12",
  "refreshedAt": "2026-02-12T22:00:00Z",
  "_cached": true,
  "_cacheAgeMinutes": 15
}
```

### `GET /api/refresh?days=60`
Forces a fresh fetch from PostHog API. Default lookback is 60 days.

**Query params:**
- `days` — Number of days to look back (default: 60)

**Response:** Same format as `/api/data` but always fresh.

## PostHog Queries

The API uses HogQL queries against the PostHog events table:

1. **User events query** — Groups all events by `person.properties.email` and date, calculating event counts and active time per day
2. **Flow events query** — Counts `flow_started`, `flow_completed`, `flow_failed` events per user

Time estimation uses the difference between first and last event per user per day, capped at 8 hours.

## Setup

### Environment Variables (set in Vercel dashboard)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTHOG_API_KEY` | ✅ | — | Personal API key from PostHog |
| `POSTHOG_PROJECT_ID` | ❌ | `54557` | PostHog project ID |
| `POSTHOG_HOST` | ❌ | `https://eu.i.posthog.com` | PostHog API host |

### Setting up in Vercel

1. Go to your project in [vercel.com](https://vercel.com)
2. Settings → Environment Variables
3. Add `POSTHOG_API_KEY` with your key (get it from PostHog → Settings → Personal API Keys)
4. Deploy

### Local Development

```bash
cp .env.example .env
# Edit .env with your real API key
npx vercel dev
```

The dashboard at `http://localhost:3000` will use the API endpoints.

## Caching

- `/api/data` caches in `/tmp` for 1 hour
- `/api/refresh` always fetches fresh data and updates the cache
- Vercel's `/tmp` is per-instance and ephemeral — cold starts trigger a fresh fetch
- The "Refresh from PostHog" button in the UI calls `/api/refresh`

## Backward Compatibility

- If the API is unavailable (e.g., running as a static file), the embedded `TIME_SERIES_DATA` is used
- The `refresh.sh` + Python pipeline still works for updating embedded data
- No API key is ever exposed to the frontend
