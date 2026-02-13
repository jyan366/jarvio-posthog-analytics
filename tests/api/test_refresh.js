/**
 * Tests for api/refresh.js
 * Uses mocked fetch to avoid real PostHog API calls
 */

const path = require('path');

// We need to test the handler and its internal logic
// Since the module exports a single handler, we'll test through it

const MOCK_HOGQL_RESPONSE = {
  results: [
    ['alice@acme.com', '2025-01-10', 42, 15],
    ['alice@acme.com', '2025-01-11', 30, 10],
    ['bob@acme.com', '2025-01-10', 20, 8],
    ['charlie@gmail.com', '2025-01-10', 10, 5],  // generic domain - should be filtered
    ['dave@bigcorp.io', '2025-01-10', 5, 3],
  ]
};

const MOCK_FLOW_RESPONSE = {
  results: [
    ['alice@acme.com', 'flow_started', 5],
    ['alice@acme.com', 'flow_completed', 4],
    ['alice@acme.com', 'flow_failed', 1],
    ['bob@acme.com', 'Flow Started', 2],
  ]
};

let fetchCallCount = 0;
let lastFetchUrls = [];

function createMockFetch() {
  fetchCallCount = 0;
  lastFetchUrls = [];
  return async (url, opts) => {
    fetchCallCount++;
    lastFetchUrls.push(url);
    // Determine which query this is by inspecting body
    const body = opts?.body ? JSON.parse(opts.body) : null;
    const isFlowQuery = body?.query?.query?.includes('flow_started');
    return {
      ok: true,
      json: async () => isFlowQuery ? MOCK_FLOW_RESPONSE : MOCK_HOGQL_RESPONSE,
      text: async () => 'ok'
    };
  };
}

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

// Save originals
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  global.fetch = createMockFetch();
  process.env.POSTHOG_API_KEY = 'test-key-123';
  process.env.POSTHOG_PROJECT_ID = '99999';
  process.env.POSTHOG_HOST = 'https://mock.posthog.com';
  // Mock fs.writeFileSync to avoid /tmp writes in test
  jest.spyOn(require('fs'), 'writeFileSync').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

// Fresh require each time to pick up env changes
function getHandler() {
  delete require.cache[require.resolve('../../api/refresh')];
  return require('../../api/refresh');
}

describe('api/refresh.js', () => {
  test('returns proper response structure', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(200);
    expect(res._json).toHaveProperty('organizations');
    expect(res._json).toHaveProperty('startDate');
    expect(res._json).toHaveProperty('endDate');
    expect(res._json).toHaveProperty('refreshedAt');
    expect(Array.isArray(res._json.organizations)).toBe(true);
  });

  test('refreshedAt is valid ISO date', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    const d = new Date(res._json.refreshedAt);
    expect(d.getTime()).not.toBeNaN();
  });

  test('date range filtering with days param', async () => {
    const handler = getHandler();

    for (const days of [7, 14, 30, 60]) {
      const res = createMockRes();
      await handler(createMockReq({ days: String(days) }), res);
      expect(res._status).toBe(200);
      const start = new Date(res._json.startDate);
      const end = new Date(res._json.endDate);
      const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(days);
    }
  });

  test('defaults to 60 days when no days param', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);
    const start = new Date(res._json.startDate);
    const end = new Date(res._json.endDate);
    const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(60);
  });

  test('distinct active minutes calculation is accurate', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    // alice@acme.com has 15 + 10 = 25 active minutes across 2 days
    const acme = res._json.organizations.find(o => o.name === 'acme.com');
    expect(acme).toBeDefined();
    const alice = acme.users.find(u => u.email === 'alice@acme.com');
    expect(alice).toBeDefined();
    expect(alice.totalTimeMinutes).toBe(25);
  });

  test('handles missing POSTHOG_API_KEY gracefully', async () => {
    delete process.env.POSTHOG_API_KEY;
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(500);
    expect(res._json.error).toMatch(/POSTHOG_API_KEY/);
  });

  test('flow analytics aggregation correct', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    const acme = res._json.organizations.find(o => o.name === 'acme.com');
    const alice = acme.users.find(u => u.email === 'alice@acme.com');
    expect(alice.flows.started).toBe(5);
    expect(alice.flows.completed).toBe(4);
    expect(alice.flows.failed).toBe(1);

    const bob = acme.users.find(u => u.email === 'bob@acme.com');
    expect(bob.flows.started).toBe(2);
  });

  test('organizations grouped by domain correctly', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    const domains = res._json.organizations.map(o => o.name);
    expect(domains).toContain('acme.com');
    expect(domains).toContain('bigcorp.io');
    // alice and bob both @acme.com should be in same org
    const acme = res._json.organizations.find(o => o.name === 'acme.com');
    expect(acme.users.length).toBe(2);
  });

  test('generic domains (gmail.com) filtered out', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    const domains = res._json.organizations.map(o => o.name);
    expect(domains).not.toContain('gmail.com');
    expect(domains).not.toContain('yahoo.com');
    expect(domains).not.toContain('hotmail.com');
  });

  test('data format matches TIME_SERIES_DATA structure', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    const org = res._json.organizations[0];
    expect(org).toHaveProperty('name');
    expect(org).toHaveProperty('users');
    const user = org.users[0];
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('totalTimeMinutes');
    expect(user).toHaveProperty('events');
    expect(user).toHaveProperty('flows');
    expect(user.flows).toHaveProperty('started');
    expect(user.flows).toHaveProperty('completed');
    expect(user.flows).toHaveProperty('failed');
    expect(user).toHaveProperty('dailyData');
  });

  test('handles PostHog API errors gracefully', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      json: async () => ({ detail: 'Unauthorized' })
    });

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(res._status).toBe(500);
    expect(res._json).toHaveProperty('error');
  });

  test('handles OPTIONS preflight', async () => {
    const handler = getHandler();
    const res = createMockRes();
    await handler({ method: 'OPTIONS' }, res);
    expect(res._status).toBe(200);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('caches result to /tmp', async () => {
    const fsSpy = require('fs').writeFileSync;
    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq(), res);

    expect(fsSpy).toHaveBeenCalledWith(
      '/tmp/posthog-dashboard-cache.json',
      expect.any(String)
    );
  });
});
