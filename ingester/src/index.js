import dotenv from 'dotenv';
dotenv.config();

import { ensureIndex, indexContent } from './search.js';
import { pool, query } from './db.js';
import { ingestGithub } from './adapters/github.js';
import { ingestFdroid } from './adapters/fdroid.js';
import { ingestArchiveMovies } from './adapters/internetarchive.js';
import { ingestSteamFree } from './adapters/steam.js';
import { ingestItch } from './adapters/itch.js';
import { ingestJamendo } from './adapters/jamendo.js';
import { ingestGutenberg } from './adapters/gutenberg.js';
import { ingestOpenLibrary } from './adapters/openlibrary.js';
import { ingestPolyHaven } from './adapters/polyhaven.js';
import { scanPending } from './adapters/virustotal.js';

async function reindexAll() {
  await ensureIndex();
  const { rows } = await query(`
    SELECT c.id, c.title, c.description, c.content_type, c.license, c.platform,
           c.size_human, c.download_url, c.thumbnail_url, c.tags, c.updated_at,
           ra.overall AS risk_overall,
           COALESCE(r.avg_stars,0) AS avg_rating,
           COALESCE(ds.total,0) AS total_downloads
    FROM content c
    LEFT JOIN risk_assessments ra ON ra.content_id = c.id
    LEFT JOIN (SELECT content_id, AVG(stars) avg_stars FROM ratings GROUP BY content_id) r ON r.content_id = c.id
    LEFT JOIN (SELECT content_id, SUM(count) total FROM download_stats GROUP BY content_id) ds ON ds.content_id = c.id
  `);
  const docs = rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    content_type: r.content_type,
    license: r.license,
    platform: r.platform || [],
    size_human: r.size_human,
    download_url: r.download_url,
    thumbnail_url: r.thumbnail_url,
    tags: r.tags || [],
    updated_at: r.updated_at,
    risk_overall: r.risk_overall || 'pending',
    avg_rating: Number(r.avg_rating) || 0,
    total_downloads: Number(r.total_downloads) || 0,
  }));
  // Meilisearch batches; chunk to be safe
  const CHUNK = 1000;
  for (let i = 0; i < docs.length; i += CHUNK) {
    await indexContent(docs.slice(i, i + CHUNK));
  }
  console.log(`Indexed ${docs.length} documents into Meilisearch.`);
}

async function linkHealthCheck() {
  const { rows } = await query(`SELECT id, download_url FROM content WHERE is_live = TRUE`);
  console.log(`Checking ${rows.length} links...`);
  let dead = 0;
  for (const r of rows) {
    try {
      const res = await fetch(r.download_url, { method: 'HEAD' });
      if (!res.ok && res.status !== 405) {
        await query(`UPDATE content SET is_live = FALSE, last_checked = now() WHERE id = $1`, [r.id]);
        dead++;
      } else {
        await query(`UPDATE content SET last_checked = now() WHERE id = $1`, [r.id]);
      }
    } catch {
      await query(`UPDATE content SET is_live = FALSE, last_checked = now() WHERE id = $1`, [r.id]);
      dead++;
    }
    await new Promise(res => setTimeout(res, 200));
  }
  console.log(`Link check done. Dead links: ${dead}`);
}

async function main() {
  const cmd = process.argv[2] || 'all';
  const arg = process.argv[3];

  try {
    if (cmd === 'github') await ingestGithub({ limit: arg ? +arg : 50 });
    else if (cmd === 'fdroid') await ingestFdroid({ limit: arg ? +arg : 200 });
    else if (cmd === 'archive') await ingestArchiveMovies({ limit: arg ? +arg : 100 });
    else if (cmd === 'steam') await ingestSteamFree({ limit: arg ? +arg : 100 });
    else if (cmd === 'itch') await ingestItch({ limit: arg ? +arg : 50 });
    else if (cmd === 'jamendo') await ingestJamendo({ limit: arg ? +arg : 100 });
    else if (cmd === 'gutenberg') await ingestGutenberg({ limit: arg ? +arg : 100 });
    else if (cmd === 'openlibrary') await ingestOpenLibrary({ limit: arg ? +arg : 100 });
    else if (cmd === 'polyhaven') await ingestPolyHaven({ limit: arg ? +arg : 100 });
    else if (cmd === 'scan') await scanPending({ limit: arg ? +arg : 50 });
    else if (cmd === 'health') await linkHealthCheck();
    else if (cmd === 'reindex') await reindexAll();
    else if (cmd === 'all') {
      await ingestGithub();
      await ingestFdroid({ limit: 100 });
      await ingestArchiveMovies({ limit: 50 });
      await ingestSteamFree({ limit: 30 });
      await ingestItch({ limit: 20 });
      await ingestJamendo({ limit: 50 });
      await ingestGutenberg({ limit: 50 });
      await ingestOpenLibrary({ limit: 50 });
      await ingestPolyHaven({ limit: 50 });
      await scanPending({ limit: 20 });
      await reindexAll();
    } else {
      console.log(`Unknown command: ${cmd}`);
      console.log('Commands: github, fdroid, archive, steam, itch, jamendo, gutenberg, openlibrary, polyhaven, scan, health, reindex, all');
    }
  } catch (e) {
    console.error('Fatal:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
