# Internal Toggle Feature

## Overview
A "Show Internal (@jarvio.io)" toggle in the dashboard header lets you show/hide internal Jarvio users and organizations.

## Behavior
- **Default: OFF** — internal domains are hidden from all views, charts, and summary stats
- **ON** — all data including internal domains is shown
- **Persists** across page refreshes via `localStorage` key `showInternal`

## Internal Domains
Defined in `INTERNAL_DOMAINS` array in `index.html`:
- `jarvio.io`
- `jarvioapp.com`

Subdomains are also matched (e.g., `sub.jarvio.io`).

## What's Filtered
When toggle is OFF, internal orgs are excluded from:
- Organization and User card views
- Summary stat cards (totals, averages)
- Usage overview chart (top-10 line chart)
- Time spent timeline chart
- Top 10 by time/events bar charts

## Implementation
- Frontend-only filtering via `isInternalDomain()` function
- Toggle checkbox in the view-toggle bar (next to Organization/User view buttons)
- `showInternal` state variable drives `.filter()` calls in `processData()` and chart builders
- API (`api/refresh.js`) returns ALL organizations; no server-side filtering needed

## Adding More Internal Domains
Add to the `INTERNAL_DOMAINS` array in `index.html`:
```js
const INTERNAL_DOMAINS = ['jarvio.io', 'jarvioapp.com', 'newdomain.com'];
```
