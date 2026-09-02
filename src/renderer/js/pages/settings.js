export async function renderSettings(root) {
  const lastSync = await window.api.animals.lastSync();

  root.innerHTML = `
    <h2 class="section-heading">Animal Database Sync</h2>
    <p class="status-banner">Runs automatically every night around 3:00 AM New York time. ${lastSync ? `Last sync: ${lastSync}.` : 'No sync recorded yet.'}</p>
    <div class="btn-row">
      <button class="btn" id="sync-now-btn">Sync Now</button>
    </div>

    <h2 class="section-heading">About</h2>
    <p class="status-banner">Jurassic AI Dashboard — a Jurassic franchise checklist, franchise wikis &amp; park maps, the book universe, a real extinct/living-animal encyclopedia, topic news feeds, and a local Ollama-powered chat.</p>
  `;

  root.querySelector('#sync-now-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Syncing…';
    try {
      await window.api.animals.syncNow();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    }
    renderSettings(root);
  });
}
