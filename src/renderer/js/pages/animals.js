import { escapeHtml } from '../util.js';

let state = { status: null, habitat: null, query: '', offset: 0 };
let searchDebounce = null;

export async function renderAnimals(root) {
  const lastSync = await window.api.animals.lastSync();

  root.innerHTML = `
    <p class="status-banner">
      Real extinct and living animals, enriched from the Paleobiology Database, GBIF, and Wikipedia.
      Grows automatically every night at 3:00 AM New York time.
      ${lastSync ? `Last synced: ${lastSync}.` : 'Not synced yet — using the built-in starter set.'}
      <button class="btn" id="sync-now-btn" style="margin-left:8px;">Sync Now</button>
    </p>
    <input type="search" id="animal-search" placeholder="Search by name…" style="margin-bottom:12px; width: 280px;" />
    <div class="filter-row">
      ${filterBtn('status', null, 'All')}
      ${filterBtn('status', 'extinct', 'Extinct')}
      ${filterBtn('status', 'extant', 'Alive Today')}
      ${filterBtn('habitat', null, 'Any Habitat')}
      ${filterBtn('habitat', 'land', 'Land')}
      ${filterBtn('habitat', 'water', 'Water')}
      ${filterBtn('habitat', 'air', 'Air')}
    </div>
    <div id="animals-count" class="meta" style="margin-bottom:8px;"></div>
    <div class="card-grid" id="animals-grid"></div>
    <div class="btn-row" id="animals-pager" style="margin-top:16px; align-items:center;"></div>
  `;

  await refreshGrid(root);

  // Attached once here (to the #animals-grid node created by the innerHTML
  // above), not inside refreshGrid — refreshGrid re-runs on every search
  // keystroke/filter click/sync within a single tab visit and only replaces
  // the grid's innerHTML, not the grid node itself, so a listener added
  // there would stack up a duplicate on every refresh.
  root.querySelector('#animals-grid').addEventListener('click', async (e) => {
    const wikiId = e.target.dataset.wiki;
    const infoId = e.target.dataset.info;

    if (wikiId) {
      const original = e.target.textContent;
      e.target.disabled = true;
      e.target.textContent = 'Loading…';
      try {
        await window.api.animals.visitWiki(Number(wikiId));
      } catch (err) {
        alert(`Could not find a Wikipedia page for this animal: ${err.message}`);
      } finally {
        e.target.disabled = false;
        e.target.textContent = original;
      }
      return;
    }

    if (infoId) {
      const card = e.target.closest('.card');
      const descEl = card?.querySelector('.desc');
      e.target.disabled = true;
      e.target.textContent = 'Loading…';
      try {
        const info = await window.api.animals.loadInfo(Number(infoId));
        if (info.description) {
          if (descEl) descEl.textContent = info.description;
          e.target.remove(); // description is cached now; button has done its job
        } else {
          // Most obscure species genuinely have no Wikipedia article — say so
          // plainly instead of leaving the button spinning or lying.
          if (descEl) descEl.textContent = 'No Wikipedia article exists for this species.';
          e.target.remove();
        }
      } catch (err) {
        e.target.textContent = 'ℹ️ Load Info';
        e.target.disabled = false;
        alert(`Could not load info: ${err.message}`);
      }
    }
  });

  // Debounced: each keystroke otherwise fires a COUNT(*) + LIKE scan across
  // ~1.8M rows, which makes typing feel like it's hanging.
  root.querySelector('#animal-search').addEventListener('input', (e) => {
    const value = e.target.value.trim();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
      state.query = value;
      state.offset = 0; // new search starts from the first page
      await refreshGrid(root);
    }, 250);
  });

  root.querySelectorAll('[data-filter-group]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state[btn.dataset.filterGroup] = btn.dataset.filterValue || null;
      state.offset = 0; // changing filters starts from the first page
      root
        .querySelectorAll(`[data-filter-group="${btn.dataset.filterGroup}"]`)
        .forEach((b) => b.classList.toggle('active', b === btn));
      await refreshGrid(root);
    });
  });

  root.querySelector('#animals-pager').addEventListener('click', async (e) => {
    const step = e.target.dataset.page;
    if (!step) return;
    state.offset = Math.max(0, state.offset + Number(step));
    await refreshGrid(root);
    root.querySelector('#animals-grid')?.scrollIntoView({ block: 'start' });
  });

  root.querySelector('#sync-now-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Syncing…';
    try {
      await window.api.animals.syncNow();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    }
    renderAnimals(root);
  });
}

async function refreshGrid(root) {
  const grid = root.querySelector('#animals-grid');
  const countEl = root.querySelector('#animals-count');
  const pager = root.querySelector('#animals-pager');

  grid.innerHTML = '<div class="status-banner">Loading…</div>';

  const result = state.query
    ? await window.api.animals.search(state.query, state.offset)
    : await window.api.animals.list({ status: state.status, habitat: state.habitat, offset: state.offset });

  const { items, total, offset, pageSize } = result;
  grid.innerHTML = items.map(renderCard).join('') || '<div class="status-banner">No matching animals.</div>';

  const first = total === 0 ? 0 : offset + 1;
  const last = offset + items.length;
  countEl.textContent = `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} animals`;

  const hasPrev = offset > 0;
  const hasNext = last < total;
  pager.innerHTML = `
    <button class="btn" data-page="${-pageSize}" ${hasPrev ? '' : 'disabled'}>← Previous</button>
    <button class="btn" data-page="${pageSize}" ${hasNext ? '' : 'disabled'}>Next →</button>
  `;
}

function filterBtn(group, value, label) {
  const active = state[group] === value;
  return `<button class="btn ${active ? 'active' : ''}" data-filter-group="${group}" data-filter-value="${value ?? ''}">${label}</button>`;
}

function renderCard(animal) {
  return `
    <div class="card">
      <h3>${escapeHtml(animal.common_name)}</h3>
      <div class="meta">${escapeHtml(animal.scientific_name || '')} · ${animal.status === 'extinct' ? '🦴 Extinct' : '🌍 Alive'} · ${capitalize(animal.habitat)}</div>
      ${animal.period ? `<div class="meta">${escapeHtml(animal.period)}</div>` : ''}
      ${animal.conservation_status ? `<div class="meta">Conservation: ${escapeHtml(animal.conservation_status)}</div>` : ''}
      <div class="desc">${escapeHtml(truncate(animal.description, 180))}</div>
      <div class="btn-row">
        ${animal.description ? '' : `<button class="btn" data-info="${animal.id}">ℹ️ Load Info</button>`}
        <button class="btn" data-wiki="${animal.id}">📖 Wikipedia ↗</button>
      </div>
    </div>
  `;
}

function capitalize(str) {
  if (!str) return '';
  return str[0].toUpperCase() + str.slice(1);
}

function truncate(str, len) {
  if (!str) return 'No description yet.';
  return str.length > len ? str.slice(0, len) + '…' : str;
}
