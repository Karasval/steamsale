const express = require('express');
const path = require('path');
const Monitor = require('./monitor');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const monitor = new Monitor();

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onLog = (line) => {
    res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
  };

  const onStatus = (status) => {
    res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
  };

  monitor.on('log', onLog);
  monitor.on('status', onStatus);

  res.write(`data: ${JSON.stringify({ type: 'status', status: monitor.getStatus() })}\n\n`);

  req.on('close', () => {
    monitor.off('log', onLog);
    monitor.off('status', onStatus);
  });
});

app.post('/start', async (req, res) => {
  const { listingsToParse, proxiesText } = req.body || {};

  const parsedCount = Number(listingsToParse);
  if (!Number.isInteger(parsedCount) || parsedCount <= 0) {
    return res.status(400).json({ ok: false, error: 'listingsToParse must be a positive integer' });
  }

  const proxies = String(proxiesText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = await monitor.start({ listingsToParse: parsedCount, proxies });
  return res.status(result.ok ? 200 : 409).json(result);
});

app.post('/stop', async (_req, res) => {
  const result = await monitor.stop();
  return res.status(200).json(result);
});

app.listen(port, () => {
  console.log(`Server is listening on http://localhost:${port}`);
});
