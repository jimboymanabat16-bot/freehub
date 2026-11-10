// Convert source-specific records into the common content schema.

const TYPE_MAP = {
  movie: 'movie', film: 'movie', video: 'movie',
  software: 'software', app: 'app', application: 'app',
  game: 'game', book: 'book', ebook: 'book',
  music: 'music', track: 'music', audio: 'music',
  asset: 'asset', font: 'asset', texture: 'asset', model: 'asset', image: 'asset',
};

const CATEGORY_BY_TYPE = {
  movie: 'movies', software: 'software', app: 'apps', game: 'games',
  book: 'books', music: 'music', asset: 'assets',
};

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function licenseNormalize(raw) {
  if (!raw) return 'Unknown';
  const s = String(raw).toLowerCase();
  if (s.includes('public domain') || s === 'pd') return 'Public Domain';
  if (s.includes('cc0')) return 'CC0';
  if (s.includes('cc-by-sa') || s.includes('cc by-sa')) return 'CC-BY-SA';
  if (s.includes('cc-by') || s.includes('cc by')) return 'CC-BY';
  if (s.includes('mit')) return 'MIT';
  if (s.includes('gpl') || s.includes('gnu')) return 'GPL';
  if (s.includes('apache')) return 'Apache-2.0';
  if (s.includes('ofl') || s.includes('open font')) return 'OFL';
  if (s.includes('bsd')) return 'BSD';
  if (s.includes('freeware')) return 'Freeware';
  if (s.includes('freemium')) return 'Freemium';
  return raw;
}

function parseSizeBytes(human) {
  if (!human) return null;
  const m = String(human).match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[m[2].toUpperCase()];
  return Math.round(n * mult);
}

export function normalize(raw) {
  const type = TYPE_MAP[String(raw.type || raw.content_type || '').toLowerCase()] || 'software';
  const title = raw.title || raw.name || 'Untitled';
  const sourceItemId = String(raw.source_item_id || raw.id || raw.identifier || title);
  return {
    source_item_id: sourceItemId,
    content_type: type,
    category_slug: raw.category_slug || CATEGORY_BY_TYPE[type],
    title,
    slug: slugify(`${title}-${sourceItemId}`).slice(0, 100),
    description: raw.description || raw.desc || null,
    license: licenseNormalize(raw.license),
    license_url: raw.license_url || null,
    platform: Array.isArray(raw.platform) ? raw.platform : (raw.platform ? [raw.platform] : []),
    version: raw.version || null,
    size_bytes: raw.size_bytes || parseSizeBytes(raw.size || raw.size_human),
    size_human: raw.size_human || raw.size || null,
    download_url: raw.download_url || raw.url,
    mirror_url: raw.mirror_url || null,
    homepage_url: raw.homepage_url || raw.homepage || null,
    thumbnail_url: raw.thumbnail_url || raw.thumbnail || raw.icon || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    language: raw.language || null,
    published_at: raw.published_at || raw.published || null,
    updated_at: raw.updated_at || raw.updated || new Date().toISOString(),
    is_redistributable: !!raw.is_redistributable,
  };
}

export default { normalize, licenseNormalize, parseSizeBytes, slugify };
