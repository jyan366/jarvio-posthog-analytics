# API Time Calculation Fix

## Problem
`api/refresh.js` returned `timeMinutes: 0` for most users because it calculated time as:
```sql
dateDiff('minute', min(timestamp), max(timestamp)) as active_minutes
```
This gives 0 when there's only 1 event in a day, or when events are clustered close together.

## Fix (2026-02-12)

### Changed time calculation to count `user_active` events
Each `user_active` event is an activity ping fired ~once per minute by the Jarvio app. Counting these gives accurate active time:

```sql
countIf(event = 'user_active') as active_pings
```

### Fallback for users without `user_active` events
For users who only have other events (no activity pings), we estimate:
```js
Math.max(1, Math.round(eventCount / 10))  // 1 min per 10 events, minimum 1
```

### Caps
- Per-day cap: 480 minutes (8 hours) as sanity check

### Row limit
- Increased HogQL query LIMIT from default (100) to 10,000 to capture all users/days

## Validation
- theamazonwhisperer.com alex@ now shows ~4800m (~80h) over 60 days instead of 0
- Compare with Python report's `_fix_user_time()` logic in `src/parse_report.py` which handles the 240m session cap redistribution from the markdown report format

## Files Changed
- `api/refresh.js` - HogQL query and time estimation logic
