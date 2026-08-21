import { escapeHtml } from '../util.js';

let history = [];

export async function renderChat(root) {
  const status = await window.api.chat.status();

  root.innerHTML = `
    <div class="chat-panel">
      ${status.reachable
        ? status.modelAvailable
          ? ''
          : `<div class="status-banner error">Ollama is running but the model "${status.model}" isn't pulled. Run: ollama pull ${status.model}</div>`
        : `<div class="status-banner error">Ollama isn't reachable at localhost:11434. Start it with: ollama serve</div>`}
      <div class="chat-log" id="chat-log">${history.map(renderMessage).join('')}</div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Ask about the franchise, or a real dinosaur/animal…" ${status.reachable ? '' : 'disabled'} />
        <button class="btn btn-primary" id="chat-send-btn" ${status.reachable ? '' : 'disabled'}>Send</button>
      </div>
    </div>
  `;

  const input = root.querySelector('#chat-input');
  const log = root.querySelector('#chat-log');

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    log.innerHTML = history.map(renderMessage).join('');
    log.scrollTop = log.scrollHeight;

    const thinkingId = 'thinking-msg';
    log.innerHTML += `<div class="chat-message assistant" id="${thinkingId}">Thinking…</div>`;
    log.scrollTop = log.scrollHeight;

    try {
      const reply = await window.api.chat.send(history);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      history.push({ role: 'assistant', content: `(error: ${err.message})` });
    }
    log.innerHTML = history.map(renderMessage).join('');
    log.scrollTop = log.scrollHeight;
  }

  root.querySelector('#chat-send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
}

function renderMessage(msg) {
  return `<div class="chat-message ${msg.role}"><strong>${msg.role === 'user' ? 'You' : 'Assistant'}:</strong> ${escapeHtml(msg.content)}</div>`;
}
