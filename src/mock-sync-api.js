const express = require('express');
const { randomUUID } = require('node:crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Demo-only in-memory store. Production must use a durable database and a
// unique constraint on (worker_id, client_event_id), plus a server UUID.
const recordsByEvent = new Map();
const recordsByServerId = new Map();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/sync-survey', (req, res) => {
  const { workerId, deviceId, clientEventId, localSurveyId, survey } = req.body || {};
  if (!workerId || !deviceId || !clientEventId || !localSurveyId || !survey) {
    return res.status(400).json({ error: 'workerId, deviceId, clientEventId, localSurveyId and survey are required' });
  }

  // Idempotency key is globally unique per worker event. Do NOT use localSurveyId
  // alone: two offline devices may both generate "School_1".
  const eventKey = `${workerId}:${clientEventId}`;
  const prior = recordsByEvent.get(eventKey);
  if (prior) {
    return res.status(200).json({ ...prior, duplicate: true });
  }

  const record = {
    serverSurveyId: randomUUID(),
    workerId,
    deviceId,
    clientEventId,
    localSurveyId,
    survey,
    receivedAt: new Date().toISOString(),
    duplicate: false
  };
  recordsByEvent.set(eventKey, record);
  recordsByServerId.set(record.serverSurveyId, record);
  return res.status(201).json(record);
});

app.get('/sync-survey/:id', (req, res) => {
  const record = recordsByServerId.get(req.params.id);
  return record ? res.json(record) : res.status(404).json({ error: 'not found' });
});

const port = Number(process.env.MOCK_API_PORT || 4174);
app.listen(port, '127.0.0.1', () => console.log(`Mock sync API listening on ${port}`));
