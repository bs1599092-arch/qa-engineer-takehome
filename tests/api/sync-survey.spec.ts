import { test, expect } from '@playwright/test';

const endpoint = 'http://127.0.0.1:4174/sync-survey';

function payload(workerId: string, deviceId: string, clientEventId: string) {
  return {
    workerId,
    deviceId,
    clientEventId,
    localSurveyId: 'School_1',
    survey: { schoolName: 'Govt Primary School', village: 'Rampur', answers: { enrollment: 120 } }
  };
}

test('same local ID on two offline devices creates two independent server records', async ({ request }) => {
  const [ankit, pooja] = await Promise.all([
    request.post(endpoint, { data: payload('ankit', 'device-A', 'event-ankit-001') }),
    request.post(endpoint, { data: payload('pooja', 'device-B', 'event-pooja-001') })
  ]);

  expect(ankit.status()).toBe(201);
  expect(pooja.status()).toBe(201);
  const a = await ankit.json();
  const p = await pooja.json();

  expect(a.localSurveyId).toBe('School_1');
  expect(p.localSurveyId).toBe('School_1');
  expect(a.serverSurveyId).not.toBe(p.serverSurveyId);
  expect(a.workerId).toBe('ankit');
  expect(p.workerId).toBe('pooja');
  expect(a.survey.schoolName).toBe('Govt Primary School');
  expect(p.survey.schoolName).toBe('Govt Primary School');
});

test('retrying the exact same event is idempotent and does not create a second record', async ({ request }) => {
  const body = payload('worker-retry', 'device-retry', `retry-${Date.now()}`);
  const first = await request.post(endpoint, { data: body });
  const firstRecord = await first.json();
  expect(first.status()).toBe(201);

  const retry = await request.post(endpoint, { data: body });
  const retryRecord = await retry.json();
  expect(retry.status()).toBe(200);
  expect(retryRecord.serverSurveyId).toBe(firstRecord.serverSurveyId);
  expect(retryRecord.duplicate).toBe(true);
});

test('missing idempotency metadata is rejected without accepting partial data', async ({ request }) => {
  const response = await request.post(endpoint, {
    data: { workerId: 'worker-x', localSurveyId: 'School_1', survey: { schoolName: 'Test' } }
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('clientEventId') });
});
