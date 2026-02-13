# Chart User-Level View Fix

## Problem
The usage overview chart (`updateUsageChart()`) always displayed per-organization data series, ignoring the `currentView` toggle. Switching to "User-Level View" changed the table/cards but the chart still showed org lines.

## Fix
Refactored `updateUsageChart()` to check `currentView`:

- **`currentView === 'organization'`** — original behavior: one line per org, aggregating all users within each org.
- **`currentView === 'user'`** — new: iterates all users across all orgs, creates one line per user email. Each user gets their own daily data series with their email as the legend label.

Both paths share helper functions (`buildUserDaily`, `applySuccessRate`) to avoid duplication. Top 10 entities by total value are shown, sorted descending.

## Files Changed
- `index.html` — `updateUsageChart()` function (lines ~2600-2780)

## Testing
1. Open dashboard, select Organization View → chart shows org names in legend
2. Toggle to User-Level View → chart shows user emails in legend
3. Change date range → both views update correctly
4. Change metric (time/events/flows) → both views reflect the metric
