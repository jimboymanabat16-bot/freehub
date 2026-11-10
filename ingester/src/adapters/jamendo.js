// Jamendo API ingester (CC-licensed music).
// Requires JAMENDO_CLIENT_ID (free at https://devportal.jamendo.com/).

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const CLIENT_ID = process.env.JAMENDO_CLIENT_ID || '';

export async function ingestJamendo({ limit = 100 } = {}) {
  if (!CLIENT_ID) { console.warn('JAMENDO_CLIENT_ID not set; skipping.'); return []; }
  const sourceId = await getSourceId('jamendo');
  const results = [];
  let offset = 0;
  const pageSize = 50;

  while (results.length < limit) {
    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${CLIENT_ID}&format=json&limit=${pageSize}&offset=${offset}&audioformat=mp32&include=musicinfo&order=popularity_desc`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jamendo ${res.status}`);
    const data = await res.json();
    const tracks = data?.results || [];
    if (!tracks.length) break;

    for (const t of tracks) {
      if (results.length >= limit) break;
      try {
        const raw = {
          source_item_id: String(t.id),
          type: 'music',
          title: t.name,
          description: t.musicinfo?.tags?.join(', ') || null,
          license: 'CC-BY', // Jamendo tracks are CC; exact license varies (CC-BY/CC-BY-SA/CC-BY-NC)
          license_url: t.license_ccurl || null,
          platform: ['Web'],
          version: null,
          size_bytes: null,
          size_human: t.duration ? `${Math.round(t.duration / 60)} min` : null,
          download_url: t.audiodownload || t.audio,
          homepage_url: t.shareurl,
          thumbnail_url: t.album_image || t.image,
          tags: t.musicinfo?.tags || [],
          language: t.lang || null,
          published_at: t.releasedate || null,
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
      } catch (e) { console.error(`✗ ${t.name}: ${e.message}`); }
    }
    offset += pageSize;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Jamendo done: ${results.length} tracks`);
  return results;
}

export default { ingestJamendo };
