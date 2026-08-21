CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE SEQUENCE seq_media_items START 1;
CREATE TABLE media_items (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_media_items'),
  file_path TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
  size_bytes BIGINT,
  last_scanned_at TEXT
);

CREATE SEQUENCE seq_checklist_items START 1;
CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_checklist_items'),
  type TEXT NOT NULL CHECK (type IN ('movie', 'series')),
  title TEXT NOT NULL,
  media_item_id INTEGER REFERENCES media_items(id),
  owns_physical_copy INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_url TEXT
);

CREATE SEQUENCE seq_maps START 1;
CREATE TABLE maps (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_maps'),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('official', 'fan')),
  source_url TEXT NOT NULL,
  image_url TEXT,
  local_image_path TEXT,
  description TEXT,
  verified_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE SEQUENCE seq_books START 1;
CREATE TABLE books (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_books'),
  title TEXT NOT NULL,
  author TEXT,
  category TEXT NOT NULL CHECK (category IN ('novel', 'junior_novelization', 'guide', 'art_book')),
  source_url TEXT NOT NULL,
  image_url TEXT,
  local_image_path TEXT,
  description TEXT,
  owns_physical_copy INTEGER NOT NULL DEFAULT 0,
  publish_year INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE SEQUENCE seq_animals START 1;
CREATE TABLE animals (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_animals'),
  common_name TEXT NOT NULL,
  scientific_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('extinct', 'extant')),
  habitat TEXT NOT NULL CHECK (habitat IN ('land', 'water', 'air', 'multiple')),
  clade TEXT,
  period TEXT,
  conservation_status TEXT,
  description TEXT,
  image_url TEXT,
  local_image_path TEXT,
  image_attribution TEXT,
  source TEXT NOT NULL CHECK (source IN ('pbdb', 'gbif', 'wikidata', 'curated')),
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);

CREATE INDEX idx_animals_status_habitat ON animals(status, habitat);
CREATE INDEX idx_animals_common_name ON animals(common_name);
