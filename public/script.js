const listingsInput = document.getElementById('listingsToParse');
const proxiesInput = document.getElementById('proxies');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const logArea = document.getElementById('logArea');

function appendLog(line) {
  const shouldStick = logArea.scrollTop + logArea.clientHeight >= logArea.scrollHeight - 5;
  logArea.textContent += `${line}\n`;
  if (shouldStick) {
    logArea.scrollTop = logArea.scrollHeight;
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

startBtn.addEventListener('click', async () => {
  try {
    const listingsToParse = Number(listingsInput.value);
    await postJson('/start', {
      listingsToParse,
      proxiesText: proxiesInput.value
    });
    appendLog('[UI] Start requested');
  } catch (err) {
    appendLog(`[UI] Start failed: ${err.message}`);
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    await postJson('/stop');
    appendLog('[UI] Stop requested');
  } catch (err) {
    appendLog(`[UI] Stop failed: ${err.message}`);
  }
});

const source = new EventSource('/logs');
source.onmessage = (event) => {
  try {
    const payload = JSON.parse(event.data);
    if (payload.type === 'status') {
      statusEl.textContent = payload.status;
      return;
    }
    if (payload.type === 'log') {
      appendLog(payload.line);
    }
  } catch (err) {
    appendLog(`[UI] Bad SSE payload: ${err.message}`);
  }
};

source.onerror = () => {
  appendLog('[UI] SSE disconnected, waiting for reconnect...');
};
