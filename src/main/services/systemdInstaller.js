const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_NAME = 'jurassic-animal-sync.service';
const TIMER_NAME = 'jurassic-animal-sync.timer';

function templatesDir() {
  // Packaged app: extraResources puts these under process.resourcesPath/systemd.
  // Dev mode: read straight from the repo's packaging/systemd folder.
  const packaged = path.join(process.resourcesPath || '', 'systemd');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', '..', 'packaging', 'systemd');
}

function scriptPath() {
  const packaged = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', 'sync-animal-db.mjs');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', '..', 'scripts', 'sync-animal-db.mjs');
}

function findNodeBin() {
  // systemd --user units don't inherit nvm shims on PATH, so an absolute
  // interpreter path is required. Prefer the currently running Electron
  // binary in ELECTRON_RUN_AS_NODE mode; fall back to `which node`.
  return process.execPath;
}

async function installTimer() {
  fs.mkdirSync(UNIT_DIR, { recursive: true });

  const dir = templatesDir();
  const serviceTemplate = fs.readFileSync(path.join(dir, `${SERVICE_NAME}.tmpl`), 'utf8');
  const timerTemplate = fs.readFileSync(path.join(dir, `${TIMER_NAME}.tmpl`), 'utf8');

  const serviceContent = serviceTemplate
    .replace('{{NODE_BIN}}', findNodeBin())
    .replace('{{SCRIPT_PATH}}', scriptPath());

  const servicePath = path.join(UNIT_DIR, SERVICE_NAME);
  const timerPath = path.join(UNIT_DIR, TIMER_NAME);

  const needsWrite =
    !fs.existsSync(servicePath) ||
    fs.readFileSync(servicePath, 'utf8') !== serviceContent ||
    !fs.existsSync(timerPath);

  if (!needsWrite) return;

  fs.writeFileSync(servicePath, serviceContent);
  fs.writeFileSync(timerPath, timerTemplate);

  try {
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
    await execFileAsync('systemctl', ['--user', 'enable', '--now', TIMER_NAME]);
    console.log('[systemd] jurassic-animal-sync.timer installed and enabled');
  } catch (err) {
    console.error(
      '[systemd] could not enable the timer automatically (systemctl unavailable or user session issue). ' +
        `Install manually with: systemctl --user daemon-reload && systemctl --user enable --now ${TIMER_NAME}`,
      err.message
    );
  }
}

module.exports = { installTimer, UNIT_DIR, SERVICE_NAME, TIMER_NAME };
