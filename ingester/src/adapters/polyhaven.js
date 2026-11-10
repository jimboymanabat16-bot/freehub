// Poly Haven (CC0 HDRIs, textures, 3D models).

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const TYPES = ['hdris', 'textures', 'models'];

export async function ingestPolyHaven({ limit = 100 } = {}) {
  const sourceId = await getSourceId('polyhaven');
  const results = [];

  for (const t of TYPES) {
    if (results.length >= limit) break;
    try {
      const res = await fetch(`https://api.polyhaven.com/assets?t=${t}`);
      if (!res.ok) throw new Error(`PolyHaven ${res.status}`);
      const data = await res.json();
      const slugs = Object.keys(data).slice(0, limit - results.length);

      for (const slug of slugs) {
        const a = data[slug];
        try {
          const raw = {
            source_item_id: `${t}:${slug}`,
            type: 'asset',
            title: a.name || slug,
            description: (a.tags || []).join(', ') || null,
            license: 'CC0',
            license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
            platform: ['Web'],
            version: null,
            size_bytes: null,
            size_human: null,
            download_url: `https://polyhaven.com/a/${slug}`,
            homepage_url: `https://polyhaven.com/a/${slug}`,
            thumbnail_url: a.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=256&height=256`,
            tags: ['polyhaven', t, ...(a.tags || [])],
            language: null,
            published_at: null,
            updated_at: new Date().toISOString(),
            is_redistributable: true,
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
        } catch (e) { console.error(`✗ ${slug}: ${e.message}`); }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.error(`PolyHaven ${t}: ${e.message}`); }
  }
  console.log(`Poly Haven done: ${results.length} assets`);
  return results;
}

export default { ingestPolyHaven };
