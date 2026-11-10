// Project Gutenberg via Gutendex API (https://gutendex.com).

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

export async function ingestGutenberg({ limit = 100, language = 'en' } = {}) {
  const sourceId = await getSourceId('gutenberg');
  const results = [];
  let url = `https://gutendex.com/books/?languages=${language}`;

  while (results.length < limit && url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gutendex ${res.status}`);
    const data = await res.json();
    const books = data.results || [];

    for (const b of books) {
      if (results.length >= limit) break;
      try {
        // pick a text/html or epub download
        const formats = b.formats || {};
        let downloadUrl = formats['text/plain; charset=utf-8'] || formats['text/plain'] ||
                          formats['application/epub+zip'] || formats['text/html'];
        if (!downloadUrl) continue;
        const raw = {
          source_item_id: String(b.id),
          type: 'book',
          title: b.title,
          description: (b.subjects || []).join(', ') || null,
          license: 'Public Domain',
          license_url: 'https://www.gutenberg.org/policy/license.html',
          platform: ['Web'],
          version: null,
          size_bytes: null,
          size_human: null,
          download_url: downloadUrl,
          homepage_url: `https://www.gutenberg.org/ebooks/${b.id}`,
          thumbnail_url: null,
          tags: b.subjects || [],
          language: (b.languages || [])[0] || language,
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
      } catch (e) { console.error(`✗ ${b.title}: ${e.message}`); }
    }
    url = data.next;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`Gutenberg done: ${results.length} books`);
  return results;
}

export default { ingestGutenberg };
