const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('../constants');

async function checkOllamaStatus() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { reachable: false, modelAvailable: false };
    const data = await res.json();
    const modelAvailable = (data.models || []).some((m) => m.name === OLLAMA_MODEL);
    return { reachable: true, modelAvailable, model: OLLAMA_MODEL };
  } catch {
    return { reachable: false, modelAvailable: false, model: OLLAMA_MODEL };
  }
}

async function chatWithOllama(messages) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.message?.content ?? '';
}

module.exports = { checkOllamaStatus, chatWithOllama };
