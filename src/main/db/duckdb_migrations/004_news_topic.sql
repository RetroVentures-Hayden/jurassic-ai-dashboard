-- The News tab now pulls one Google News feed per dashboard topic (the Jurassic
-- franchise, prehistoric/fossil discoveries, and wildlife & conservation)
-- instead of a single franchise-only query. This column tags each stored
-- headline with its topic so the tab can group them. Rows that predate the
-- split stay NULL and are shown under the franchise heading -- which is what
-- they were.
ALTER TABLE news_items ADD COLUMN topic TEXT;
