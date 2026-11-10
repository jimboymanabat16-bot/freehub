// Open Library (public-domain / borrowable books).

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

export async function ingestOpenLibrary({ limit = 100, query = 'subject:public domain' } = {}) {
  const sourceId = await getSourceId('openlibrary');
  const results = [];
  let offset = 0;
  const pageSize = 50;

  while (results.length < limit) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&has_fulltext=true&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenLibrary ${res.status}`);
    const data = await res.json();
    const docs = data.docs || [];
    if (!docs.length) break;

    for (const d of docs) {
      if (results.length >= limit) break;
      try {
        const key = d.key; // e.g. /works/OL123W
        const coverUrl = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null;
        // Link to the IA full-text scan if available
        const iaId = d.ia && d.ia[0];
        const downloadUrl = iaId ? `https://archive.org/details/${iaId}` : `https://openlibrary.org${key}`;
        const raw = {
          source_item_id: key,
          type: 'book',
          title: d.title,
          description: (d.subject || []).slice(0, 10).join(', ') || null,
          license: 'Public Domain', // only ingest when has_fulltext; verify per item in production
          license_url: null,
          platform: ['Web'],
          version: null,
          size_bytes: null,
          size_human: null,
          download_url: downloadUrl,
          homepage_url: `https://openlibrary.org${key}`,
          thumbnail_url: coverUrl,
          tags: (d.subject || []).slice(0, 10),
          language: (d.language || [])[0] || null,
          published_at: d.first_publish_year ? `${d.first_publish_year}-01-01` : null,
          updated_at: new Date().toISOString(),
          is_redistributable: false, // link out to IA
        };
        const norm = normalize(raw);
        const categoryId = await getCategoryId(norm.category_slug);
        const id = await upsertContent({ ...norm, source_id: sourceId, category_id: categoryId });
        await upsertRisk(id, {
          overall: 'caution', vt_positives: 0, vt_total: 0, vt_scan_date: null,
          is_signed: false, signer: null, license_clear: false, // verify license per item
          last_scanned: new Date().toISOString(), user_reports: 0,
        });
        results.push({ id, title: norm.title });
      } catch (e) { console.error(`✗ ${d.title}: ${e.message}`); }
    }
    offset += pageSize;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Open Library done: ${results.length} books`);
  return results;
}

export default { ingestOpenLibrary };
