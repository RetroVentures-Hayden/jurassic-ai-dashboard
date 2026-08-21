const fs = require('node:fs');
const path = require('node:path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm']);

// Explicit filename -> canonical title mapping, rather than parsing release-group
// tags (RARBG/YIFY/HDCAM/etc.) with regex, since only a small known set of files
// is expected in this folder and fragile parsing isn't worth it.
const KNOWN_FILES = {
  'Jurassic.Park.1993.REMASTERED.1080p.BluRay.H264.AAC-RARBG.mp4': {
    title: 'Jurassic Park (1993)',
    year: 1993,
    checklistTitle: 'Jurassic Park (1993)',
  },
  'Jurassic.Park.2.The.Lost.World.1997.1080p.BluRay.H264.AAC-RARBG.mp4': {
    title: 'The Lost World: Jurassic Park (1997)',
    year: 1997,
    checklistTitle: 'The Lost World: Jurassic Park (1997)',
  },
  'Jurassic.Park.3.2001.1080p.BluRay.H264.AAC-RARBG.mp4': {
    title: 'Jurassic Park III (2001)',
    year: 2001,
    checklistTitle: 'Jurassic Park III (2001)',
  },
  'Jurassic.World.2015.1080p.BluRay.x264.YIFY.mp4': {
    title: 'Jurassic World (2015)',
    year: 2015,
    checklistTitle: 'Jurassic World (2015)',
  },
  'Jurassic.World.Fallen.Kingdom.2018.1080p.BluRay.x264.[2GB].mp4': {
    title: 'Jurassic World: Fallen Kingdom (2018)',
    year: 2018,
    checklistTitle: 'Jurassic World: Fallen Kingdom (2018)',
  },
  'Jurassic.World.Dominion.2022.1080p.NEW.x264.AAC.3000MB..HDCAM.mkv': {
    title: 'Jurassic World Dominion (2022)',
    year: 2022,
    checklistTitle: 'Jurassic World Dominion (2022)',
  },
  'Jurassic.World.Rebirth.2025.1080p.WEBRip.AAC5.1.10bits.x265-Rapta.mkv': {
    title: 'Jurassic World Rebirth (2025)',
    year: 2025,
    checklistTitle: 'Jurassic World Rebirth (2025)',
  },
};

function identify(fileName) {
  if (KNOWN_FILES[fileName]) return KNOWN_FILES[fileName];
  // Fallback for any future/unknown file dropped into the folder: use the
  // filename (dots -> spaces, extension stripped) as a best-effort title.
  const base = fileName.replace(path.extname(fileName), '');
  const yearMatch = base.match(/\b(19|20)\d{2}\b/);
  return {
    title: base.replace(/\./g, ' ').trim(),
    year: yearMatch ? parseInt(yearMatch[0], 10) : null,
    checklistTitle: null,
  };
}

function scanLibrary(libraryPath) {
  if (!fs.existsSync(libraryPath)) return [];

  return fs
    .readdirSync(libraryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const filePath = path.join(libraryPath, entry.name);
      const stat = fs.statSync(filePath);
      const identified = identify(entry.name);
      return {
        file_path: filePath,
        file_name: entry.name,
        title: identified.title,
        year: identified.year,
        checklistTitle: identified.checklistTitle,
        kind: 'movie',
        size_bytes: stat.size,
        last_scanned_at: new Date().toISOString(),
      };
    });
}

module.exports = { scanLibrary, KNOWN_FILES };
