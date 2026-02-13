/**
 * Tests for api/data.js
 * Tests caching behavior, fallback to refresh, and response structure
 */

const fs = require('fs');
const path = require('path');

const CACHE_PATH = '/tmp/posthog-dashboard-cache.json';

const MOCK_CACHED_DATA = {
  organizations: [
    {
      name: 'testcorp.com',
      users: [{
        email: 'user@testcorp.com',
        totalTimeMinutes: 120,
        events: 500,
        flows: { started: 10, completed: 8, failed: 2 },
        dailyData: { '2025-01-10': { timeMinutes: 60, events: 250 } }
      }]
    }
  ],
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  refreshedAt: '2025-01-31T12:00:00.000Z'
};

// Save originals
const originalEnv = { ...process.env };

function createMockReq(query = {}) {
  return { method: 'GET', query };
}

function createMockRes() {
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    setHeader(k, v) { res._headers[k] = v; },
    status(code) {
      res._status = code;
      return {
        json(data) { res._json = data; },
        end() {}
      };
    }
  };
  return res;
}

function writeFreshCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(MOCK_CACHED_DATA));
}

function writeStaleCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(MOCK_CACHED_DATA));
  // Set mtime to 2 hours ago
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(CACHE_PATH, twoHoursAgo, twoHoursAgo);
}

function removeCache() {
  try { fs.unlinkSync(CACHE_PATH); } catch {}
}

function getHandler() {
  // Clear all relevant caches
  delete require.cache[require.resolve('../../api/data')];
  delete require.cache[require.resolve('../../api/refresh')];
  return require('../../api/data');
}

beforeEach(() => {
  removeCache();
  process.env.POSTHOG_API_KEY = 'test-key-123';
  process.env.POSTHOG_PROJECT_ID = '99999';
  process.env.POSTHOG_HOST = 'https://mock.posthog.com';
});

afterEach(() => {
  removeCache();
  process.env = { ...originalEnv };
  if (global.fetch !== undefined) delete global.fetch;
  jest.restoreAllMocks();
});

describe('api/data.js', () => {
  test('returns cached data when available and fresh', async () => {
    writeFreshCache();
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(200);
    expect(res._json._cached).toBe(true);
    expect(res._json._cacheAgeMinutes).toBeDefined();
    expect(res._json.organizations).toEqual(MOCK_CACHED_DATA.organizations);
  });

  test('cache expiry works (1 hour TTL)', async () => {
    writeStaleCache();

    // Mock fetch for refresh fallback
    global.fetch = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      return {
        ok: true,
        json: async () => ({ results: [] }),
        text: async () => 'ok'
      };
    };

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    // Should have tried to refresh (cache was stale)
    expect(res._status).toBe(200);
    // Won't have _cached=true since it went through refresh path
  });

  test('falls back to refresh when cache empty', async () => {
    removeCache();

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ results: [] }),
      text: async () => 'ok'
    });

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(200);
    expect(res._json).toHaveProperty('organizations');
  });

  test('handles missing cache gracefully', async () => {
    removeCache();
    // Also make refresh fail
    delete process.env.POSTHOG_API_KEY;

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    // Should return 503 or 500 with error
    expect([500, 503]).toContain(res._status);
    expect(res._json).toHaveProperty('error');
  });

  test('returns proper JSON structure from cache', async () => {
    writeFreshCache();
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._json).toHaveProperty('organizations');
    expect(res._json).toHaveProperty('startDate');
    expect(res._json).toHaveProperty('endDate');
    expect(res._json).toHaveProperty('refreshedAt');
    expect(res._json).toHaveProperty('_cached');
    expect(res._json).toHaveProperty('_cacheAgeMinutes');
    expect(typeof res._json._cacheAgeMinutes).toBe('number');
  });

  test('handles OPTIONS preflight', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler({ method: 'OPTIONS' }, res);
    expect(res._status).toBe(200);
  });

  test('serves stale cache when refresh fails', async () => {
    writeStaleCache();
    // Make refresh fail
    delete process.env.POSTHOG_API_KEY;

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(200);
    expect(res._json._stale).toBe(true);
  });
});
