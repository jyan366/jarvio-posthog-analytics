/**
 * Vercel Serverless Function: /api/refresh
 * 
 * Fetches customer usage data from PostHog API and returns it in the
 * TIME_SERIES_DATA format expected by the dashboard.
 * 
 * Environment variables required:
 *   POSTHOG_API_KEY      - Personal API key for PostHog
 *   POSTHOG_PROJECT_ID   - Project ID (default: 54557)
 *   POSTHOG_HOST         - API host (default: https://eu.i.posthog.com)
 */

const GENERIC_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'protonmail.com', 'aol.com', 'mail.com',
  'mozmail.com'
];

const SESSION_GAP_MINUTES = 30; // gap threshold for session splitting

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.POSTHOG_API_KEY;
  const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '54557';
  const HOST = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';

  if (!API_KEY) {
    return res.status(500).json({ error: 'POSTHOG_API_KEY not configured' });
  }

  try {
    const daysBack = parseInt(req.query?.days || '60', 10);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const startStr = fmt(startDate);
    const endStr = fmt(endDate);

    console.log(`Fetching PostHog data: ${startStr} to ${endStr}`);

    // Step 1: Get all persons (users) with their events
    const userData = await fetchAllUserEvents(HOST, PROJECT_ID, API_KEY, startStr, endStr);

    // Step 2: Group by organization domain
    const orgMap = {};
    for (const [email, data] of Object.entries(userData)) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain || GENERIC_DOMAINS.includes(domain)) continue;

      if (!orgMap[domain]) orgMap[domain] = [];
      orgMap[domain].push({ email, ...data });
    }

    // Step 3: Build TIME_SERIES_DATA format
    const organizations = Object.entries(orgMap).map(([domain, users]) => ({
      name: domain,
      users: users.map(u => ({
        email: u.email,
        totalTimeMinutes: Math.round(u.totalTimeMinutes),
        events: u.totalEvents,
        flows: {
          started: u.flowsStarted || 0,
          completed: u.flowsCompleted || 0,
          failed: u.flowsFailed || 0
        },
        dailyData: u.dailyData
      }))
    }));

    const result = {
      organizations,
      startDate: startStr,
      endDate: endStr,
      refreshedAt: new Date().toISOString()
    };

    // Cache in /tmp for data.js to read
    const fs = require('fs');
    fs.writeFileSync('/tmp/posthog-dashboard-cache.json', JSON.stringify(result));

    return res.status(200).json(result);
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function fmt(d) {
  return d.toISOString().split('T')[0];
}

async function posthogQuery(host, projectId, apiKey, path, body) {
  const url = `${host}/api/projects/${projectId}${path}`;
  const resp = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`PostHog API ${resp.status}: ${text.slice(0, 500)}`);
  }
  return resp.json();
}

async function fetchAllPages(host, projectId, apiKey, path, params = {}) {
  const results = [];
  const query = new URLSearchParams(params).toString();
  let url = `${host}/api/projects/${projectId}${path}${query ? '?' + query : ''}`;

  while (url) {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`PostHog API ${resp.status}: ${text.slice(0, 500)}`);
    }
    const data = await resp.json();
    results.push(...(data.results || []));
    url = data.next || null;
    // Safety limit
    if (results.length > 50000) break;
  }
  return results;
}

async function fetchAllUserEvents(host, projectId, apiKey, startDate, endDate) {
  // Use the events endpoint with date filtering to get all events
  // Then aggregate per-user with time estimation
  
  const userData = {};

  // Query 1: Get events grouped by person with daily breakdown using HogQL
  const eventsQuery = await posthogQuery(host, projectId, apiKey, '/query/', {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT 
          person.properties.email as email,
          toDate(timestamp) as day,
          count() as event_count,
          min(timestamp) as first_event,
          max(timestamp) as last_event,
          dateDiff('minute', min(timestamp), max(timestamp)) as active_minutes
        FROM events
        WHERE timestamp >= '${startDate}' 
          AND timestamp <= '${endDate}T23:59:59'
          AND person.properties.email IS NOT NULL
          AND person.properties.email != ''
        GROUP BY email, day
        ORDER BY email, day
      `
    }
  });

  if (eventsQuery.results) {
    for (const row of eventsQuery.results) {
      const [email, day, eventCount, firstEvent, lastEvent, activeMinutes] = row;
      if (!email || !email.includes('@')) continue;
      
      const cleanEmail = email.toLowerCase().trim();
      if (!userData[cleanEmail]) {
        userData[cleanEmail] = {
          totalEvents: 0,
          totalTimeMinutes: 0,
          flowsStarted: 0,
          flowsCompleted: 0,
          flowsFailed: 0,
          dailyData: {}
        };
      }

      const dayStr = typeof day === 'string' ? day.split(' ')[0] : day;
      // Estimate time: use active_minutes but cap at reasonable session length
      const timeEst = Math.min(activeMinutes || 0, 480); // cap at 8h per day
      
      userData[cleanEmail].totalEvents += eventCount;
      userData[cleanEmail].totalTimeMinutes += timeEst;
      userData[cleanEmail].dailyData[dayStr] = {
        timeMinutes: Math.round(timeEst * 10) / 10,
        events: eventCount
      };
    }
  }

  // Query 2: Get flow events (started/completed/failed)
  try {
    const flowsQuery = await posthogQuery(host, projectId, apiKey, '/query/', {
      query: {
        kind: 'HogQLQuery',
        query: `
          SELECT 
            person.properties.email as email,
            event,
            count() as cnt
          FROM events
          WHERE timestamp >= '${startDate}' 
            AND timestamp <= '${endDate}T23:59:59'
            AND event IN ('flow_started', 'flow_completed', 'flow_failed', 
                          'Flow Started', 'Flow Completed', 'Flow Failed',
                          '$flow_started', '$flow_completed', '$flow_failed')
            AND person.properties.email IS NOT NULL
          GROUP BY email, event
        `
      }
    });

    if (flowsQuery.results) {
      for (const [email, event, count] of flowsQuery.results) {
        if (!email) continue;
        const cleanEmail = email.toLowerCase().trim();
        if (!userData[cleanEmail]) continue;

        const evtLower = event.toLowerCase().replace('$', '');
        if (evtLower.includes('started')) {
          userData[cleanEmail].flowsStarted += count;
        } else if (evtLower.includes('completed')) {
          userData[cleanEmail].flowsCompleted += count;
        } else if (evtLower.includes('failed')) {
          userData[cleanEmail].flowsFailed += count;
        }
      }
    }
  } catch (e) {
    console.warn('Flow query failed (non-fatal):', e.message);
  }

  return userData;
}
