# FreeHub Ingester

Node.js ingestion pipeline for the FreeHub aggregator. Pulls genuinely free content
from trusted sources, normalizes it, scans it, and indexes it for search.

## Sources

| Adapter | Source | Command |
|---|---|---|
| `github.js` | GitHub releases (trusted repos) | `npm run ingest:github` |
| `fdroid.js` | F-Droid index (Android FOSS) | `npm run ingest:fdroid` |
| `internetarchive.js` | Internet Archive (public-domain films) | `npm run ingest:archive` |
| `steam.js` | Steam free-to-play games | `npm run ingest:steam` |
| `virustotal.js` | VirusTotal URL scanner | `npm run scan` |

## One-click deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_USER/YOUR_REPO)

> Replace `YOUR_USER/YOUR_REPO` with your actual GitHub repo path after pushing.

## Setup

1. Install deps: `npm install`
2. Copy `.env.example` to `.env` and fill in keys.
3. Create the database: `createdb freehub` then `psql freehub -f sql/schema.sql`
4. Start Meilisearch: `meilisearch --master-key=...` (or use Docker).
5. Run: `npm run ingest` (runs all adapters + scan + reindex).

## Commands

- `npm run ingest` — run all adapters, scan, reindex
- `npm run ingest:github` — GitHub only
- `npm run ingest:fdroid` — F-Droid only
- `npm run ingest:archive` — Internet Archive only
- `npm run ingest:steam` — Steam only
- `npm run ingest:itch` — itch.io (curated)
- `npm run ingest:jamendo` — Jamendo (needs JAMENDO_CLIENT_ID)
- `npm run ingest:gutenberg` — Project Gutenberg via Gutendex
- `npm run ingest:openlibrary` — Open Library
- `npm run ingest:polyhaven` — Poly Haven (CC0 assets)
- `npm run scan` — VirusTotal scan pending items
- `npm run health` — link health check
- `npm run server` — start REST API (port 3001)
- `npm run dev` — server with watch mode

## REST API

- `GET /api/content` — search + filters (q, type, license, platform, safety, rating, sort, page, limit)
- `GET /api/content/:id` — detail
- `POST /api/content/:id/download` — track download
- `GET /api/content/meta/filters` — distinct filter values
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST/DELETE /api/saved`, `GET /api/saved/lists`, `GET/POST/DELETE /api/saved/alerts`
- `POST /api/submissions`, `GET /api/submissions`, `POST /api/submissions/:id/approve|reject` (admin)

## Notes

- All content aggregated is genuinely free (public domain, OSS, freeware, CC).
- Nothing is rehosted unless the license permits redistribution (`is_redistributable`).
- Steam / Play Store / Bandcamp items are link-out only.
- VirusTotal free tier: 4 req/min, 500/day — the scanner waits 16s between calls.
- GitHub: 60 req/hr unauth, 5000/hr with token.

## License

MIT
