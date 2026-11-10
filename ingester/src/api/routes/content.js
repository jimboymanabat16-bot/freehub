import express from 'express';
import { pool } from '../../db.js';
import { ensureIndex } from '../../search.js';
import { authOptional } from '../middleware/auth.js';

const router = express.Router();

// GET /api/content  (search + filters)
router.get('/', async (req, res) => {
  try {
    const {
      q, type, license, platform, safety, rating, sort = 'newest',
      page = 1, limit = 24,
    } = req.query;

    // Use Meilisearch if available; fall back to Postgres ILIKE
    let ids = null;
    try {
      const { MeiliSearch } = await import('meilisearch');
      const client = new MeiliSearch({ host: process.env.MEILI_HOST || 'http://localhost:7700', apiKey: process.env.MEILI_API_KEY || '' });
      const filters = [];
      if (type) filters.push(`content_type = "${type}"`);
      if (license) filters.push(`license = "${license}"`);
      if (platform) filters.push(`platform = "${platform}"`);
      if (safety) filters.push(`risk_overall = "${safety}"`);
      const sortMap = {
        newest: ['updated_at:desc'],
        rating: ['avg_rating:desc'],
        downloads: ['total_downloads:desc'],
        name: ['title:asc'],
      };
      const r = await client.index('content').search(q || '', {
        filter: filters.length ? filters.join(' AND ') : undefined,
        sort: sortMap[sort],
        limit: Math.min(+limit, 100),
        offset: (+page - 1) * +limit,
      });
      ids = r.hits.map(h => h.id);
      res.set('X-Total-Count', String(r.estimatedTotalHits || r.hits.length));
    } catch (e) {
      // Meilisearch unavailable; fall through to PG
    }

    let sql, params;
    if (ids && ids.length) {
      sql = `SELECT * FROM content_view WHERE id = ANY($1::uuid[])`;
      params = [ids];
    } else {
      const where = ['is_live = TRUE'];
      params = [];
      let i = 1;
      if (q) { where.push(`(title ILIKE $${i} OR description ILIKE $${i})`); params.push(`%${q}%`); i++; }
      if (type) { where.push(`content_type = $${i}`); params.push(type); i++; }
      if (license) { where.push(`license = $${i}`); params.push(license); i++; }
      if (platform) { where.push(`$${i} = ANY(platform)`); params.push(platform); i++; }
      if (safety) { where.push(`risk_overall = $${i}`); params.push(safety); i++; }
      if (rating) { where.push(`avg_rating >= $${i}`); params.push(+rating); i++; }
      const sortMap = {
        newest: 'updated_at DESC',
        rating: 'avg_rating DESC',
        downloads: 'total_downloads DESC',
        name: 'title ASC',
      };
      sql = `SELECT * FROM content_view WHERE ${where.join(' AND ')} ORDER BY ${sortMap[sort] || 'updated_at DESC'} LIMIT $${i} OFFSET $${i+1}`;
      params.push(Math.min(+limit, 100), (+page - 1) * +limit);
    }
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows, page: +page, limit: +limit });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM content_view WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content/:id/download (track download)
router.post('/:id/download', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO download_stats (content_id, day, count) VALUES ($1, $2, 1)
      ON CONFLICT (content_id, day) DO UPDATE SET count = download_stats.count + 1
    `, [req.params.id, today]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/filters (distinct values for UI)
router.get('/meta/filters', async (req, res) => {
  try {
    const licenses = await pool.query('SELECT DISTINCT license FROM content ORDER BY license');
    const platforms = await pool.query(`SELECT DISTINCT unnest(platform) AS p FROM content ORDER BY p`);
    const types = await pool.query('SELECT DISTINCT content_type FROM content ORDER BY content_type');
    res.json({
      licenses: licenses.rows.map(r => r.license),
      platforms: platforms.rows.map(r => r.p),
      types: types.rows.map(r => r.content_type),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
