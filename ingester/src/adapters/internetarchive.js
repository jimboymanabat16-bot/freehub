// Internet Archive movie fetcher.
// Searches for public-domain / CC-licensed feature films and shorts.

import { getSourceId, getCategoryId, upsertContent, upsertRisk } from '../db.js';
import { normalize } from '../normalizer.js';

const SEARCH_URL = 'https://archive.org/advancedsearch.php';

export async function ingestArchiveMovies({ limit = 100, query = 'mediatype:movies AND (licenseurl:*creativecommons* OR collection:feature_films OR collection:short_films)' } = {}) {
  const sourceId = await getSourceId('archive');
  const results = [];
  let page = 1;
  const rows = 50;

  while (results.length < limit) {
    const params = new URLSearchParams({
      q: query,
      fl: 'identifier,title,description,creator,licenseurl,mediatype,item_size,addeddate,publicdate,subject,year',
      sort: 'downloads desc',
      rows: String(rows),
      page: String(page),
      output: 'json',
    });
    const res = await fetch(`${SEARCH_URL}?${params}`);
    if (!res.ok) throw new Error(`IA search ${res.status}`);
    const data = await res.json();
    const docs = data?.response?.docs || [];
    if (!docs.length) break;

    for (const d of docs) {
      if (results.length >= limit) break;
      try {
        // fetch file list to get a playable/downloadable file
        const filesRes = await fetch(`https://archive.org/metadata/${d.identifier}/files`);
        const filesData = await filesRes.json();
        const files = filesData?.result || [];
        // prefer mp4/h.264 or ogg; else first video file
        const videoFile = files.find(f => /\.(mp4|ogv|webm|avi|mkv)$/i.test(f.name) && !f.name.includes('_thumb')) ||
                          files.find(f => f.format && /video/i.test(f.format));
        if (!videoFile) continue;

        const downloadUrl = `https://archive.org/download/${d.identifier}/${encodeURIComponent(videoFile.name)}`;
        const sizeBytes = parseInt(videoFile.size, 10) || null;

        // Map IA subjects -> our movie genres
        const subjects = Array.isArray(d.subject) ? d.subject : (d.subject ? [d.subject] : []);
        const subjectText = subjects.join(' ').toLowerCase();
        const genreMap = [
          ['horror', 'Horror'], ['comedy', 'Comedy'], ['drama', 'Drama'],
          ['sci-fi', 'Sci-Fi'], ['science fiction', 'Sci-Fi'], ['action', 'Action'],
          ['thriller', 'Thriller'], ['romance', 'Romance'], ['documentary', 'Documentary'],
          ['animation', 'Animation'], ['animated', 'Animation'], ['western', 'Western'],
          ['noir', 'Noir'], ['fantasy', 'Fantasy'],
        ];
        const genres = [];
        for (const [kw, g] of genreMap) {
          if (subjectText.includes(kw) && !genres.includes(g)) genres.push(g);
        }
        if (!genres.length) genres.push('Drama'); // default
        // Era from year
        const year = parseInt(d.year || (d.publicdate || '').slice(0, 4), 10);
        let era = 'Modern (2000s+)';
        if (year && year < 1929) era = 'Silent (pre-1929)';
        else if (year && year < 1970) era = 'Classic (30s-60s)';
        else if (year && year < 2000) era = 'Retro (70s-90s)';
        const tags = ['movie', 'public-domain', ...genres, era];

        const raw = {
          source_item_id: d.identifier,
          type: 'movie',
          title: d.title || d.identifier,
          description: (d.description || '').slice(0, 1000),
          license: d.licenseurl ? 'CC-BY' : 'Public Domain',
          license_url: d.licenseurl || null,
          platform: ['Web'],
          version: null,
          size_bytes: sizeBytes,
          size_human: sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(0)} MB` : null,
          download_url: downloadUrl,
          homepage_url: `https://archive.org/details/${d.identifier}`,
          thumbnail_url: `https://archive.org/services/img/${d.identifier}`,
          tags,
          language: null,
          published_at: d.publicdate || d.addeddate || null,
          updated_at: d.addeddate || new Date().toISOString(),
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
          is_signed: false,
          signer: null,
          license_clear: true,
          last_scanned: new Date().toISOString(),
          user_reports: 0,
        });

        results.push({ id, title: norm.title });
        console.log(`✓ ${norm.title}`);
      } catch (e) {
        console.error(`✗ ${d.identifier}: ${e.message}`);
      }
      await new Promise(res => setTimeout(res, 300)); // IA rate limit
    }
    page++;
    if (docs.length < rows) break;
  }
  console.log(`Internet Archive done: ${results.length} movies`);
  return results;
}

export default { ingestArchiveMovies };
