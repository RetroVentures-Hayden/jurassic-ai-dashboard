CREATE SEQUENCE seq_news_items START 1;
CREATE TABLE news_items (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_news_items'),
  title TEXT NOT NULL,
  link TEXT UNIQUE NOT NULL,
  published_at TEXT,
  source TEXT,
  summary TEXT,
  fetched_at TEXT NOT NULL
);

CREATE SEQUENCE seq_sync_log START 1;
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY DEFAULT nextval('seq_sync_log'),
  run_at TEXT NOT NULL,
  ny_date TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'catchup', 'manual', 'force')),
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_message TEXT
);
