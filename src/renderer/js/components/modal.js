const dialog = document.getElementById('image-modal');
const titleEl = document.getElementById('image-modal-title');
const imgEl = document.getElementById('image-modal-img');
const placeholderEl = document.getElementById('image-modal-placeholder');
const descriptionEl = document.getElementById('image-modal-description');
const visitBtn = document.getElementById('image-modal-visit');
const closeBtn = document.getElementById('image-modal-close');

closeBtn.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

/**
 * opts: { title, description, onVisit, loadImage: () => Promise<string|null> }
 * loadImage should resolve to a local file path (or null) — it's called lazily
 * so the modal can show a loading state immediately and fill the image in
 * once the main process has resolved/downloaded it. onVisit is invoked when
 * the "Visit Site" button is clicked (typically an IPC call that opens the
 * real URL via shell.openExternal).
 */
export function openModal({ title, description, onVisit, loadImage }) {
  titleEl.textContent = title || '';
  descriptionEl.textContent = description || '';
  imgEl.style.display = 'none';
  placeholderEl.hidden = false;
  placeholderEl.textContent = 'Loading image…';
  imgEl.src = '';
  visitBtn.onclick = onVisit || null;

  dialog.showModal();

  if (typeof loadImage === 'function') {
    loadImage()
      .then((localPath) => {
        if (!localPath) {
          placeholderEl.hidden = false;
          placeholderEl.textContent = 'No preview image available yet';
          imgEl.style.display = 'none';
          return;
        }
        // Electron: getImage gives an absolute fs path -> file://. Web build:
        // the shim already returns a ready "/local-file?p=..." (or an http) URL.
        imgEl.src =
          localPath.startsWith('/local-file') || /^https?:/i.test(localPath)
            ? localPath
            : `file://${localPath}`;
        imgEl.style.display = 'block';
        placeholderEl.hidden = true;
      })
      .catch(() => {
        placeholderEl.hidden = false;
        placeholderEl.textContent = 'Could not load preview image';
        imgEl.style.display = 'none';
      });
  } else {
    placeholderEl.hidden = false;
    placeholderEl.textContent = 'No preview image available yet';
  }
}

