-- Widen maps.category to allow a third value, 'wiki', for Jurassic-franchise
-- wiki sites listed alongside the in-universe ('official') and fan-made ('fan')
-- maps in the renamed "Wiki/Maps" tab. DuckDB can't drop an unnamed CHECK
-- constraint in place, so the table is rebuilt with the widened constraint and
-- its existing rows are copied across. The seq_maps sequence (and its use as
-- the id default) is left untouched.
CREATE TABLE maps_new (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_maps'),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('official', 'fan', 'wiki')),
  source_url TEXT NOT NULL,
  image_url TEXT,
  local_image_path TEXT,
  description TEXT,
  verified_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO maps_new (id, title, category, source_url, image_url, local_image_path, description, verified_at, sort_order)
  SELECT id, title, category, source_url, image_url, local_image_path, description, verified_at, sort_order FROM maps;

DROP TABLE maps;
ALTER TABLE maps_new RENAME TO maps;
