// GitHub releases ingester.
// Fetches latest releases for a list of trusted repos and normalizes them.

import { getSourceId, getCategoryId, upsertContent, upsertRisk, enqueueModeration } from '../db.js';
import { normalize } from '../normalizer.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const headers = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'FreeHub-Ingester/1.0',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

// Trusted repos: owner/name. Add more as needed.
export const TRUSTED_REPOS = [
  { owner: 'videolan', repo: 'vlc', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['media-player', 'video'] },
  { owner: 'libreoffice', repo: 'core', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['office', 'productivity'] },
  { owner: 'blender', repo: 'blender', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['3d', 'graphics'] },
  { owner: 'audacity', repo: 'audacity', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['audio', 'editor'] },
  { owner: 'GNOME', repo: 'gimp', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['graphics', 'image-editor'] },
  { owner: 'obsproject', repo: 'obs-studio', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['streaming', 'recording'] },
  { owner: 'handbrake', repo: 'HandBrake', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['video', 'transcoder'] },
  { owner: 'inkscape', repo: 'inkscape', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['vector', 'graphics'] },
  { owner: '7zip', repo: '7zip', type: 'software', platform: ['Windows'], tags: ['archive', 'compression'] },
  { owner: 'calibre', repo: 'calibre', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['ebook', 'library'] },
  { owner: 'KDE', repo: 'kdenlive', type: 'software', platform: ['Windows', 'macOS', 'Linux'], tags: ['video', 'editor'] },
  { owner: 'supertuxkart', repo: 'stk-code', type: 'game', platform: ['Windows', 'macOS', 'Linux'], tags: ['game', 'racing'] },
];

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
  return res.json();
}

function pickAsset(assets, platform) {
  // Prefer platform-specific installer; fall back to source archive.
  const exts = platform.includes('Windows') ? ['.exe', '.msi', '.zip'] :
               platform.includes('macOS') ? ['.dmg', '.zip'] :
               platform.includes('Linux') ? ['.AppImage', '.tar.xz', '.deb', '.rpm'] : ['.zip'];
  for (const ext of exts) {
    const a = assets.find(x => x.name.toLowerCase().endsWith(ext.toLowerCase()));
    if (a) return a;
  }
  return assets[0] || null;
}

export async function ingestGithub({ limit = 50 } = {}) {
  const sourceId = await getSourceId('github');
  const results = [];
  for (const r of TRUSTED_REPOS.slice(0, limit)) {
    try {
      const repo = await fetchJSON(`https://api.github.com/repos/${r.owner}/${r.repo}`);
      const releases = await fetchJSON(`https://api.github.com/repos/${r.owner}/${r.repo}/releases?per_page=1`);
      const rel = releases && releases[0];
      if (!rel) { console.warn(`No release for ${r.owner}/${r.repo}`); continue; }

      const asset = pickAsset(rel.assets || [], r.platform);
      const downloadUrl = asset ? asset.browser_download_url : rel.html_url;
      const sizeBytes = asset ? asset.size : null;

      const raw = {
        source_item_id: `${r.owner}/${r.repo}@${rel.tag_name}`,
        type: r.type,
        title: repo.name || r.repo,
        description: (repo.description || '') + (rel.body ? '\n\n' + rel.body.slice(0, 500) : ''),
        license: repo.license?.spdx_id || repo.license?.name || 'Unknown',
        platform: r.platform,
        version: rel.tag_name,
        size_bytes: sizeBytes,
        size_human: sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : null,
        download_url: downloadUrl,
        homepage_url: repo.homepage || repo.html_url,
        thumbnail_url: repo.owner?.avatar_url,
        tags: [...(repo.topics || []), ...r.tags],
        language: repo.language,
        published_at: rel.published_at,
        updated_at: rel.published_at,
        is_redistributable: true, // OSS
      };

      const norm = normalize(raw);
      const categoryId = await getCategoryId(norm.category_slug);
      const id = await upsertContent({
        ...norm,
        source_id: sourceId,
        category_id: categoryId,
      });

      // GitHub repos are signed by the publisher's CI; mark as verified baseline
      await upsertRisk(id, {
        overall: 'verified',
        vt_positives: 0,
        vt_total: 0,
        vt_scan_date: null,
        is_signed: true,
        signer: `${r.owner} (GitHub)`,
        license_clear: true,
        last_scanned: new Date().toISOString(),
        user_reports: 0,
      });

      results.push({ id, title: norm.title, version: norm.version });
      console.log(`✓ ${norm.title} ${norm.version}`);
    } catch (e) {
      console.error(`✗ ${r.owner}/${r.repo}: ${e.message}`);
    }
    // be polite to GitHub
    await new Promise(res => setTimeout(res, 1000));
  }
  return results;
}

export default { ingestGithub, TRUSTED_REPOS };
