import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://freehub:freehub@localhost:5432/freehub',
  max: 20,
  idleTimeoutMillis: 30000,
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

export async function upsertContent(row) {
  const sql = `
    INSERT INTO content (
      source_id, source_item_id, content_type, category_id, title, slug, description,
      license, license_url, platform, version, size_bytes, size_human, download_url,
      mirror_url, homepage_url, thumbnail_url, tags, language, published_at, updated_at,
      is_redistributable
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
    )
    ON CONFLICT (source_id, source_item_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      version = EXCLUDED.version,
      size_bytes = EXCLUDED.size_bytes,
      size_human = EXCLUDED.size_human,
      download_url = EXCLUDED.download_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      tags = EXCLUDED.tags,
      updated_at = EXCLUDED.updated_at,
      last_checked = now()
    RETURNING id;
  `;
  const params = [
    row.source_id, row.source_item_id, row.content_type, row.category_id, row.title,
    row.slug, row.description, row.license, row.license_url, row.platform, row.version,
    row.size_bytes, row.size_human, row.download_url, row.mirror_url, row.homepage_url,
    row.thumbnail_url, row.tags, row.language, row.published_at, row.updated_at,
    row.is_redistributable,
  ];
  const { rows } = await pool.query(sql, params);
  return rows[0].id;
}

export async function upsertRisk(contentId, risk) {
  await pool.query(`
    INSERT INTO risk_assessments (content_id, overall, vt_positives, vt_total, vt_scan_date,
      is_signed, signer, license_clear, last_scanned, user_reports)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (content_id) DO UPDATE SET
      overall = EXCLUDED.overall,
      vt_positives = EXCLUDED.vt_positives,
      vt_total = EXCLUDED.vt_total,
      vt_scan_date = EXCLUDED.vt_scan_date,
      is_signed = EXCLUDED.is_signed,
      signer = EXCLUDED.signer,
      license_clear = EXCLUDED.license_clear,
      last_scanned = EXCLUDED.last_scanned,
      user_reports = EXCLUDED.user_reports,
      updated_at = now();
  `, [
    contentId, risk.overall, risk.vt_positives, risk.vt_total, risk.vt_scan_date,
    risk.is_signed, risk.signer, risk.license_clear, risk.last_scanned, risk.user_reports || 0,
  ]);
}

export async function enqueueModeration(contentId) {
  await pool.query(`
    INSERT INTO moderation_queue (content_id) VALUES ($1)
    ON CONFLICT DO NOTHING;
  `, [contentId]).catch(() => {});
}

export async function getSourceId(slug) {
  const { rows } = await pool.query('SELECT id FROM sources WHERE slug = $1', [slug]);
  if (!rows.length) throw new Error(`Unknown source: ${slug}`);
  return rows[0].id;
}

export async function getCategoryId(slug) {
  const { rows } = await pool.query('SELECT id FROM categories WHERE slug = $1', [slug]);
  return rows.length ? rows[0].id : null;
}

export { pool };
export default { query, upsertContent, upsertRisk, enqueueModeration, getSourceId, getCategoryId, pool };
