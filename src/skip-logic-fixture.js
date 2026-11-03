const express = require('express');
const path = require('node:path');
const app = express();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/survey/hobbies', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'tests', 'fixtures', 'skip-logic.html'));
});

const port = Number(process.env.MOCK_WEB_PORT || 4173);
app.listen(port, '127.0.0.1', () => console.log(`Skip-logic fixture listening on ${port}`));
