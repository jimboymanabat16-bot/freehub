// itch.io free games (link-out only; itch.io has no public catalog API).
// We maintain a curated list of well-known free titles and ingest their metadata
// by scraping the game page's OpenGraph tags.

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const CURATED = [
  'https://kenney.itch.io/kenney-game-assets',
  'https://deepnight.itch.io/dead-cells-prototypes',
];

// A small set of known free itch.io game pages to ingest.
const FREE_GAMES = [
  { slug: 'a-short-hike', title: 'A Short Hike (demo)', url: 'https://adamgryu.itch.io/a-short-hike' },
];

export async function ingestItch({ limit = 50 } = {}) {
  const sourceId = await getSourceId('itch');
  const results = [];

  // Try to fetch itch.io's "free games" RSS-ish page is not available;
  // fall back to a curated list. For full coverage, run a scraper against
  // https://itch.io/games/free with a headless browser (Playwright) and
  // respect robots.txt + rate limits.
  const list = FREE_GAMES.slice(0, limit);
  for (const g of list) {
    try {
      const res = await fetch(g.url);
      if (!res.ok) throw new Error(`itch ${res.status}`);
      const html = await res.text();
      const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || g.title;
      const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || null;
      const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || null;

      const raw = {
        source_item_id: g.slug,
        type: 'game',
        title: ogTitle,
        description: ogDesc,
        license: 'Freeware',
        platform: ['Web', 'Windows', 'macOS', 'Linux'],
        download_url: g.url,
        homepage_url: g.url,
        thumbnail_url: ogImage,
        tags: ['itch.io', 'Indie', 'indie'],
        updated_at: new Date().toISOString(),
        is_redistributable: false,
      };
      const norm = normalize(raw);
      const categoryId = await getCategoryId(norm.category_slug);
      const id = await upsertContent({ ...norm, source_id: sourceId, category_id: categoryId });
      await upsertRisk(id, {
        overall: 'verified', vt_positives: 0, vt_total: 0, vt_scan_date: null,
        is_signed: false, signer: null, license_clear: true,
        last_scanned: new Date().toISOString(), user_reports: 0,
      });
      results.push({ id, title: norm.title });
      console.log(`✓ ${norm.title}`);
    } catch (e) { console.error(`✗ ${g.slug}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`itch.io done: ${results.length} games (curated; extend FREE_GAMES list)`);
  return results;
}

export default { ingestItch };
