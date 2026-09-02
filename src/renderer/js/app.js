import { renderChecklist } from './pages/checklist.js';
import { renderMaps } from './pages/maps.js';
import { renderBooks } from './pages/books.js';
import { renderAnimals } from './pages/animals.js';
import { renderNews } from './pages/news.js';
import { renderChat } from './pages/chat.js';
import { renderSettings } from './pages/settings.js';

const pages = {
  checklist: renderChecklist,
  maps: renderMaps,
  books: renderBooks,
  animals: renderAnimals,
  news: renderNews,
  chat: renderChat,
  settings: renderSettings,
};

const content = document.getElementById('tab-content');
const navButtons = document.querySelectorAll('.tab-btn');

async function showTab(tabName) {
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  content.innerHTML = '<div class="status-banner">Loading…</div>';
  try {
    await pages[tabName](content);
  } catch (err) {
    content.innerHTML = `<div class="status-banner error">Failed to load this tab: ${err.message}</div>`;
    console.error(err);
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

showTab('checklist');
