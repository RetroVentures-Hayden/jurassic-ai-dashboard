export async function renderSettings(root) {
  const settings = await window.api.settings.get();
  const lastSync = await window.api.animals.lastSync();

  root.innerHTML = `
    <h2 class="section-heading">Media Library</h2>
    <p class="status-banner">Current folder: ${settings.library_path}</p>
    <div class="btn-row">
      <button class="btn" id="pick-folder-btn">Choose Folder…</button>
    </div>

    <h2 class="section-heading">Animal Database Sync</h2>
    <p class="status-banner">Runs automatically every night around 3:00 AM New York time via a systemd timer, even if the app is closed. ${lastSync ? `Last sync: ${lastSync}.` : 'No sync recorded yet.'}</p>
    <div class="btn-row">
      <button class="btn" id="sync-now-btn">Sync Now</button>
    </div>

    <h2 class="section-heading">About</h2>
    <p class="status-banner">Jurassic AI Dashboard — local movies, checklist, maps, books, a real animal encyclopedia, franchise news, and a local Ollama-powered chat, all running on this machine.</p>
  `;

  root.querySelector('#pick-folder-btn').addEventListener('click', async () => {
    const newPath = await window.api.settings.pickLibraryFolder();
    if (newPath) renderSettings(root);
  });

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
