import { escapeHtml } from '../util.js';
import { openModal } from '../components/modal.js';

const CATEGORY_LABELS = {
  novel: 'Novels',
  junior_novelization: 'Junior Novelizations',
  guide: 'Guides & Scripts',
  art_book: 'Art & Visual History Books',
};

export async function renderBooks(root) {
  const books = await window.api.books.list();
  const byCategory = {};
  for (const book of books) {
    byCategory[book.category] = byCategory[book.category] || [];
    byCategory[book.category].push(book);
  }

  const sections = Object.entries(CATEGORY_LABELS)
    .map(([key, label]) => {
      const list = byCategory[key] || [];
      return `
        <h2 class="section-heading">${label}</h2>
        <div class="card-grid">${list.map(renderCard).join('') || '<div class="status-banner">No entries yet.</div>'}</div>
      `;
    })
    .join('');
  root.innerHTML = `<div id="books-container">${sections}</div>`;

  root.querySelector('#books-container').addEventListener('click', async (e) => {
    if (e.target.dataset.open) {
      const book = books.find((b) => b.id === Number(e.target.dataset.open));
      if (!book) return;
      openModal({
        title: book.title,
        description: `${book.author ? book.author + ' — ' : ''}${book.description || ''}`,
        onVisit: () => window.api.books.visit(book.id),
        loadImage: () => window.api.books.getImage(book.id),
      });
    }
    if (e.target.dataset.toggle) {
      await window.api.books.toggleOwned(Number(e.target.dataset.toggle));
      renderBooks(root);
    }
  });
}

function renderCard(book) {
  const owned = !!book.owns_physical_copy;
  return `
    <div class="card">
      <h3>${escapeHtml(book.title)}</h3>
      <div class="meta">${escapeHtml(book.author || '')}${book.publish_year ? ' · ' + book.publish_year : ''}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-open="${book.id}">View</button>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" data-toggle="${book.id}" ${owned ? 'checked' : ''} />
        Own physical copy
      </label>
    </div>
  `;
}
