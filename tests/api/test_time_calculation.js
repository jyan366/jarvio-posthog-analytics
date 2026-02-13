/**
 * Tests for time calculation accuracy
 * Focuses on the distinct minute counting logic in refresh.js
 */

const fs = require('fs');

const originalEnv = { ...process.env };

function createMockReq(query = {}) {
  return { method: 'GET', query };
}

function createMockRes() {
  const res = {
    _status: null, _json: null, _headers: {},
    setHeader(k, v) { res._headers[k] = v; },
    status(code) {
      res._status = code;
      return { json(data) { res._json = data; }, end() {} };
    }
  };
  return res;
}

function getHandler() {
  delete require.cache[require.resolve('../../api/refresh')];
  return require('../../api/refresh');
}

function mockFetchWithEvents(rows, flowRows = []) {
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    const isFlowQuery = body?.query?.query?.includes('flow_started');
    return {
      ok: true,
      json: async () => isFlowQuery ? { results: flowRows } : { results: rows },
      text: async () => 'ok'
    };
  };
}

beforeEach(() => {
  process.env.POSTHOG_API_KEY = 'test-key';
  process.env.POSTHOG_PROJECT_ID = '99999';
  process.env.POSTHOG_HOST = 'https://mock.posthog.com';
  jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('Time calculation accuracy', () => {
  test('distinct minute counting - single user single day', async () => {
    // User has 45 events in 12 distinct minutes
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 45, 12],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const org = res._json.organizations.find(o => o.name === 'test.com');
    const user = org.users[0];
    expect(user.totalTimeMinutes).toBe(12);
    expect(user.dailyData['2025-01-10'].timeMinutes).toBe(12);
  });

  test('distinct minutes across multiple days sum correctly', async () => {
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 100, 30],
      ['user@test.com', '2025-01-11', 80, 25],
      ['user@test.com', '2025-01-12', 50, 15],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.totalTimeMinutes).toBe(70); // 30 + 25 + 15
  });

  test('does not overcount - zero active minutes means zero time', async () => {
    // Edge case: events exist but active_minutes is 0 (all in same minute?)
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 5, 0],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.totalTimeMinutes).toBe(0);
  });

  test('no overcounting - active minutes never exceed event count', async () => {
    // 3 events can span at most 3 distinct minutes
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 3, 3],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.totalTimeMinutes).toBeLessThanOrEqual(3);
  });

  test('heavy user does not exceed reasonable daily limits', async () => {
    // Even a very active user: 500 events, 180 active minutes (3 hours)
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 500, 180],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    // 180 min = 3h, reasonable. Should not be > 720 (12h)
    expect(user.totalTimeMinutes).toBeLessThanOrEqual(720);
    expect(user.dailyData['2025-01-10'].timeMinutes).toBe(180);
  });

  test('daily aggregation is preserved per day', async () => {
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 10, 5],
      ['user@test.com', '2025-01-11', 20, 10],
      ['user@test.com', '2025-01-12', 30, 15],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.dailyData['2025-01-10']).toEqual({ timeMinutes: 5, events: 10 });
    expect(user.dailyData['2025-01-11']).toEqual({ timeMinutes: 10, events: 20 });
    expect(user.dailyData['2025-01-12']).toEqual({ timeMinutes: 15, events: 30 });
  });

  test('multiple users at same org have independent time tracking', async () => {
    mockFetchWithEvents([
      ['alice@test.com', '2025-01-10', 100, 30],
      ['bob@test.com', '2025-01-10', 50, 20],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const org = res._json.organizations.find(o => o.name === 'test.com');
    const alice = org.users.find(u => u.email === 'alice@test.com');
    const bob = org.users.find(u => u.email === 'bob@test.com');
    expect(alice.totalTimeMinutes).toBe(30);
    expect(bob.totalTimeMinutes).toBe(20);
  });

  test('sparse activity pattern - few events spread across minutes', async () => {
    // 5 events in 5 distinct minutes (1 event per minute)
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 5, 5],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.totalTimeMinutes).toBe(5);
  });

  test('burst activity pattern - many events in few minutes', async () => {
    // 200 events but only in 3 distinct minutes (rapid clicking)
    mockFetchWithEvents([
      ['user@test.com', '2025-01-10', 200, 3],
    ]);

    const handler = getHandler();
    const res = createMockRes();
    await handler(createMockReq({ days: '7' }), res);

    const user = res._json.organizations[0].users[0];
    expect(user.totalTimeMinutes).toBe(3); // Not 200!
  });
});
