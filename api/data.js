/**
 * Vercel Serverless Function: /api/data
 * 
 * Returns the latest cached dashboard data.
 * If no cache exists, triggers a refresh automatically.
 */

const fs = require('fs');
const CACHE_PATH = '/tmp/posthog-dashboard-cache.json';
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Check for cached data
    if (fs.existsSync(CACHE_PATH)) {
      const stat = fs.statSync(CACHE_PATH);
      const ageMs = Date.now() - stat.mtimeMs;

      if (ageMs < CACHE_MAX_AGE_MS) {
        const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        cached._cached = true;
        cached._cacheAgeMinutes = Math.round(ageMs / 60000);
        return res.status(200).json(cached);
      }
    }

    // No valid cache — trigger refresh inline
    const refreshHandler = require('./refresh');
    
    // Create a mock response to capture the refresh result
    let refreshResult = null;
    const mockRes = {
      status: (code) => ({
        json: (data) => { refreshResult = { code, data }; },
        end: () => { refreshResult = { code, data: null }; }
      }),
      setHeader: () => {}
    };

    await refreshHandler(req, mockRes);

    if (refreshResult && refreshResult.code === 200) {
      return res.status(200).json(refreshResult.data);
    }

    // Refresh failed — try stale cache
    if (fs.existsSync(CACHE_PATH)) {
      const stale = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      stale._stale = true;
      return res.status(200).json(stale);
    }

    return res.status(503).json({ 
      error: 'No data available. Refresh failed.',
      details: refreshResult?.data
    });
  } catch (err) {
    console.error('Data endpoint error:', err);
    
    // Last resort: try stale cache
    if (fs.existsSync(CACHE_PATH)) {
      const stale = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      stale._stale = true;
      stale._error = err.message;
      return res.status(200).json(stale);
    }
    
    return res.status(500).json({ error: err.message });
  }
};
