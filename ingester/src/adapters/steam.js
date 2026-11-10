// Steam free-to-play filter.
// Uses Steam Web API to find free-to-play games and normalizes them.

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const STEAM_KEY = process.env.STEAM_API_KEY || '';
const APP_LIST_URL = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/';
const APP_DETAILS_URL = 'https://store.steampowered.com/api/appdetails';

export async function ingestSteamFree({ limit = 100 } = {}) {
  if (!STEAM_KEY) {
    console.warn('STEAM_API_KEY not set; falling back to curated known free appids.');
  }
  const sourceId = await getSourceId('steam');
  const results = [];

  // Curated list of well-known free-to-play Steam appids (extend as needed).
  // In production, fetch the full app list and filter by price; this avoids
  // hammering the appdetails endpoint for 100k+ apps.
  const FREE_APPIDS = [
    730, 570, 440, 578080, 1172470, 230410, 236390, 252950, 271590,
    304930, 346110, 431960, 550, 10, 4000, 105600, 205790, 218620,
    242760, 291550, 333930, 335190, 386360, 438100, 555570, 582010,
    629760, 648800, 755790, 892970, 945360, 1085660, 1131720, 1203220,
  ].slice(0, limit);

  for (const appid of FREE_APPIDS) {
    try {
      const url = `${APP_DETAILS_URL}?appids=${appid}&cc=us&l=en`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Steam ${res.status}`);
      const data = await res.json();
      const app = data?.[appid];
      if (!app?.success) continue;
      const d = app.data;
      if (d.type !== 'game') continue;
      // confirm it's actually free
      const price = d.price_overview;
      if (price && price.final !== 0) continue;
      if (d.is_free !== true && !(price && price.final === 0)) continue;

      const raw = {
        source_item_id: String(appid),
        type: 'game',
        title: d.name,
        description: (d.short_description || '').slice(0, 1000),
        license: 'Freeware', // Steam free-to-play, not redistributable
        platform: ['Windows'], // Steam handles platform; simplify
        version: null,
        size_bytes: null,
        size_human: null,
        download_url: `https://store.steampowered.com/app/${appid}`,
        homepage_url: `https://store.steampowered.com/app/${appid}`,
        thumbnail_url: d.header_image || null,
        tags: (() => {
          const raw = (d.genres || []).map(g => g.description);
          const canon = ['Action','Adventure','RPG','Strategy','Simulation','Puzzle','Racing','Sports','Horror','Indie','Casual'];
          const mapped = raw.map(g => {
            const low = g.toLowerCase();
            if (low.includes('action')) return 'Action';
            if (low.includes('adventure')) return 'Adventure';
            if (low.includes('rpg') || low.includes('role')) return 'RPG';
            if (low.includes('strategy')) return 'Strategy';
            if (low.includes('simulation') || low.includes('simulator')) return 'Simulation';
            if (low.includes('puzzle')) return 'Puzzle';
            if (low.includes('racing') || low.includes('racer')) return 'Racing';
            if (low.includes('sports')) return 'Sports';
            if (low.includes('horror')) return 'Horror';
            if (low.includes('indie')) return 'Indie';
            if (low.includes('casual')) return 'Casual';
            return null;
          }).filter(Boolean);
          return [...new Set([...raw, ...mapped])];
        })(),
        language: 'en',
        published_at: d.release_date?.date || null,
        updated_at: new Date().toISOString(),
        is_redistributable: false, // link out only
      };

      const norm = normalize(raw);
      const categoryId = await getCategoryId(norm.category_slug);
      const id = await upsertContent({ ...norm, source_id: sourceId, category_id: categoryId });

      await upsertRisk(id, {
        overall: 'verified',
        vt_positives: 0,
        vt_total: 0,
        vt_scan_date: null,
        is_signed: true, // Steam-signed delivery
        signer: 'Valve/Steam',
        license_clear: true,
        last_scanned: new Date().toISOString(),
        user_reports: 0,
      });

      results.push({ id, title: norm.title });
      console.log(`✓ ${norm.title}`);
      await new Promise(res => setTimeout(res, 1500)); // Steam rate limit
    } catch (e) {
      console.error(`✗ appid ${appid}: ${e.message}`);
    }
  }
  console.log(`Steam done: ${results.length} free games`);
  return results;
}

export default { ingestSteamFree };
