-- FreeHub catalog schema (Postgres 14+)
-- Run: psql $DATABASE_URL -f sql/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- categories ----------
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  parent_id   INT REFERENCES categories(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL,          -- movie, software, app, game, book, music, asset
  icon        TEXT,
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);

-- ---------- sources ----------
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,    -- github, fdroid, archive, steam, itch, ...
  name        TEXT NOT NULL,
  base_url    TEXT,
  trust_tier  TEXT NOT NULL DEFAULT 'community',  -- official, trusted, community, unknown
  is_active   BOOLEAN DEFAULT TRUE
);

-- ---------- content ----------
CREATE TABLE IF NOT EXISTS content (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id     INT REFERENCES sources(id),
  source_item_id TEXT,                 -- upstream id (repo name, IA identifier, appid)
  content_type  TEXT NOT NULL,
  category_id   INT REFERENCES categories(id),
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE,
  description   TEXT,
  license       TEXT NOT NULL,          -- SPDX-ish: MIT, GPL-3.0, CC0, CC-BY-4.0, Public Domain, Freeware
  license_url   TEXT,
  platform      TEXT[],                -- {Windows,macOS,Linux,Android,iOS,Web}
  version       TEXT,
  size_bytes    BIGINT,
  size_human    TEXT,
  download_url  TEXT NOT NULL,
  mirror_url    TEXT,                  -- only for redistributable content
  homepage_url  TEXT,
  thumbnail_url TEXT,
  tags          TEXT[] DEFAULT '{}',
  language      TEXT,
  published_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ DEFAULT now(),
  last_checked  TIMESTAMPTZ,
  is_live       BOOLEAN DEFAULT TRUE,   -- link health
  is_redistributable BOOLEAN DEFAULT FALSE,
  UNIQUE (source_id, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type);
CREATE INDEX IF NOT EXISTS idx_content_license ON content(license);
CREATE INDEX IF NOT EXISTS idx_content_title_trgm ON content USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_tags ON content USING gin (tags);

-- ---------- ratings ----------
CREATE TABLE IF NOT EXISTS ratings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id  UUID REFERENCES content(id) ON DELETE CASCADE,
  user_id     UUID,                   -- null for anonymous/imported
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (content_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_content ON ratings(content_id);

-- ---------- risk assessments ----------
CREATE TABLE IF NOT EXISTS risk_assessments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id    UUID UNIQUE REFERENCES content(id) ON DELETE CASCADE,
  overall       TEXT NOT NULL DEFAULT 'pending',  -- verified, caution, flagged, pending
  vt_positives  INT DEFAULT 0,
  vt_total      INT DEFAULT 0,
  vt_scan_date  TIMESTAMPTZ,
  is_signed     BOOLEAN,
  signer        TEXT,
  license_clear BOOLEAN DEFAULT FALSE,
  last_scanned  TIMESTAMPTZ,
  user_reports  INT DEFAULT 0,
  report_reasons TEXT[] DEFAULT '{}',
  notes         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------- download stats ----------
CREATE TABLE IF NOT EXISTS download_stats (
  content_id  UUID REFERENCES content(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  count       INT DEFAULT 0,
  PRIMARY KEY (content_id, day)
);

-- ---------- moderation queue ----------
CREATE TABLE IF NOT EXISTS moderation_queue (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id  UUID REFERENCES content(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  submitted_by TEXT,
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------- helper view: content with aggregated rating + risk ----------
CREATE OR REPLACE VIEW content_view AS
SELECT
  c.*,
  COALESCE(r.avg_stars, 0)::numeric(3,2) AS avg_rating,
  COALESCE(r.review_count, 0) AS review_count,
  COALESCE(ds.total_downloads, 0) AS total_downloads,
  ra.overall AS risk_overall,
  ra.vt_positives, ra.vt_total, ra.is_signed, ra.license_clear,
  ra.last_scanned, ra.user_reports
FROM content c
LEFT JOIN (
  SELECT content_id, AVG(stars)::numeric(3,2) AS avg_stars, COUNT(*) AS review_count
  FROM ratings GROUP BY content_id
) r ON r.content_id = c.id
LEFT JOIN (
  SELECT content_id, SUM(count) AS total_downloads FROM download_stats GROUP BY content_id
) ds ON ds.content_id = c.id
LEFT JOIN risk_assessments ra ON ra.content_id = c.id;

-- ---------- seed categories ----------
INSERT INTO categories (slug, name, content_type, icon, sort_order) VALUES
  ('movies','Movies','movie','🎬',1),
  ('software','Software','software','📦',2),
  ('apps','Apps','app','📱',3),
  ('games','Games','game','🎮',4),
  ('books','Books','book','📚',5),
  ('music','Music','music','🎵',6),
  ('assets','Assets','asset','🎨',7)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sources (slug, name, base_url, trust_tier) VALUES
  ('github','GitHub','https://github.com','trusted'),
  ('fdroid','F-Droid','https://f-droid.org','trusted'),
  ('archive','Internet Archive','https://archive.org','trusted'),
  ('steam','Steam','https://store.steampowered.com','official'),
  ('itch','itch.io','https://itch.io','trusted'),
  ('gutenberg','Project Gutenberg','https://gutenberg.org','trusted'),
  ('jamendo','Jamendo','https://jamendo.com','trusted'),
  ('openlibrary','Open Library','https://openlibrary.org','trusted'),
  ('polyhaven','Poly Haven','https://polyhaven.com','trusted')
ON CONFLICT (slug) DO NOTHING;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',  -- user, admin
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_login    TIMESTAMPTZ
);

-- ---------- saved items ----------
CREATE TABLE IF NOT EXISTS saved_items (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  content_id  UUID REFERENCES content(id) ON DELETE CASCADE,
  list_name   TEXT NOT NULL DEFAULT 'favorites',
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, content_id, list_name)
);

-- ---------- alerts ----------
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  query       TEXT,
  category    TEXT,
  license     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_sent   TIMESTAMPTZ
);

-- ---------- submissions ----------
CREATE TABLE IF NOT EXISTS submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  license       TEXT,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  content_id    UUID REFERENCES content(id),     -- set when approved
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
