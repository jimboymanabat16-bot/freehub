
Aggregator for genuinely free content (public-domain movies, open-source software, freeware, creative assets) with star ratings and risk assessments.

## Live demo

- Frontend (GitHub Pages): enable in repo Settings → Pages → deploy from `main` branch.
- Backend: see `ingester/README.md` for Render.com one-click deploy.

## Run locally

See `ingester/README.md` for full setup. Quick start:

```powershell
cd ingester
npm install
# create DB + run sql/schema.sql
npm run ingest
npm run server
```

Then open `index.html` in a browser.

## Structure

- `index.html` — self-contained frontend (works offline with demo data)
- `ingester/` — Node.js ingestion pipeline + REST API
- `.github/workflows/pages.yml` — auto-deploy frontend to GitHub Pages
- `netlify.toml` — Netlify Drop config
- `deploy/` — static snapshot for drag-and-drop hosting
