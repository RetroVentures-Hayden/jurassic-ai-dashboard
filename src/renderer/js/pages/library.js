import { escapeHtml } from '../util.js';

export async function renderLibrary(root) {
  const items = await window.api.library.list();

  root.innerHTML = `
    <div class="btn-row" style="margin-bottom:16px;">
      <button class="btn" id="rescan-btn">Rescan Folder</button>
    </div>
    <div class="card-grid" id="library-grid"></div>
  `;

  const grid = root.querySelector('#library-grid');
  if (!items.length) {
    grid.innerHTML = `<div class="status-banner">No video files found yet. Use Settings to point at your movies folder, then Rescan.</div>`;
  } else {
    grid.innerHTML = items
      .map(
        (item) => `
        <div class="card">
          <h3>${escapeHtml(item.title)}</h3>
          <div class="meta">${item.year || ''} · ${formatSize(item.size_bytes)}</div>
          <div class="btn-row">
            <button class="btn btn-primary" data-play="${item.id}">▶ Play</button>
          </div>
        </div>`
      )
      .join('');
  }

  grid.addEventListener('click', async (e) => {
    const id = e.target.dataset.play;
    if (!id) return;
    e.target.disabled = true;
    e.target.textContent = 'Opening…';
    try {
      await window.api.library.play(Number(id));
    } catch (err) {
      alert(`Could not launch player: ${err.message}`);
    } finally {
      e.target.disabled = false;
      e.target.textContent = '▶ Play';
    }
  });

  root.querySelector('#rescan-btn').addEventListener('click', async () => {
    await window.api.library.rescan();
    renderLibrary(root);
  });
}

function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}
