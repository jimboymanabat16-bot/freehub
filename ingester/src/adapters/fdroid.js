// F-Droid index parser.
// Downloads the F-Droid v2 index, extracts app metadata + latest APK download URL.

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const INDEX_URL = 'https://f-droid.org/repo/index-v2.json';

export async function ingestFdroid({ limit = 200 } = {}) {
  const sourceId = await getSourceId('fdroid');
  console.log('Fetching F-Droid index (this may take a while)...');
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`F-Droid index ${res.status}`);
  const data = await res.json();

  // index-v2 shape: { repos: [...], packages: { "com.foo": { metadata: {...}, versions: {...} } } }
  const packages = data.packages || {};
  const ids = Object.keys(packages).slice(0, limit);
  const results = [];

  for (const pkgId of ids) {
    try {
      const p = packages[pkgId];
      const meta = p.metadata || {};
      // latest version: versions is an object keyed by versionCode
      const versionKeys = Object.keys(p.versions || {});
      const latestKey = versionKeys.sort((a, b) => Number(b) - Number(a))[0];
      const ver = latestKey ? p.versions[latestKey] : null;
      if (!ver || !ver.file?.name) continue;

      const apkName = ver.file.name;
      const downloadUrl = `https://f-droid.org/repo/${apkName}`;
      const sizeBytes = ver.file.size || null;

      const raw = {
        source_item_id: pkgId,
        type: 'app',
        title: meta.name || pkgId,
        description: meta.summary || meta.description || null,
        license: meta.license || 'Unknown',
        platform: ['Android'],
        version: ver.versionName || ver.versionCode || null,
        size_bytes: sizeBytes,
        size_human: sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : null,
        download_url: downloadUrl,
        homepage_url: meta.webSite || null,
        thumbnail_url: meta.icon ? `https://f-droid.org/repo/${meta.icon}` : null,
        tags: meta.categories || [],
        language: null,
        published_at: ver.added || null,
        updated_at: ver.added || new Date().toISOString(),
        is_redistributable: true,
      };

      const norm = normalize(raw);
      const categoryId = await getCategoryId(norm.category_slug);
      const id = await upsertContent({ ...norm, source_id: sourceId, category_id: categoryId });

      await upsertRisk(id, {
        overall: 'verified',
        vt_positives: 0,
        vt_total: 0,
        vt_scan_date: null,
        is_signed: true, // F-Droid signs all APKs
        signer: 'F-Droid',
        license_clear: !!meta.license,
        last_scanned: new Date().toISOString(),
        user_reports: 0,
      });

      results.push({ id, title: norm.title });
      if (results.length % 25 === 0) console.log(`  ${results.length} apps ingested`);
    } catch (e) {
      console.error(`✗ ${pkgId}: ${e.message}`);
    }
  }
  console.log(`F-Droid done: ${results.length} apps`);
  return results;
}

export default { ingestFdroid };
