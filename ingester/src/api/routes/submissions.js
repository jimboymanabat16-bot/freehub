import express from 'express';
import { pool, getSourceId, getCategoryId, upsertContent, enqueueModeration } from '../../db.js';
import { normalize } from '../../normalizer.js';
import { authRequired, authOptional, adminRequired } from '../middleware/auth.js';

const router = express.Router();

// POST /api/submissions  (any user or anonymous)
router.post('/', authOptional, async (req, res) => {
  try {
    const { title, url, contentType, license, description } = req.body || {};
    if (!title || !url || !contentType) return res.status(400).json({ error: 'title, url, contentType required' });
    const { rows } = await pool.query(`
      INSERT INTO submissions (user_id, title, url, content_type, license, description)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.user?.id || null, title, url, contentType, license || null, description || null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/submissions  (admin: all; user: own)
router.get('/', authRequired, async (req, res) => {
  try {
    let sql, params;
    if (req.user.role === 'admin') {
      sql = `SELECT s.*, u.email AS submitter_email FROM submissions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`;
      params = [];
    } else {
      sql = `SELECT * FROM submissions WHERE user_id = $1 ORDER BY created_at DESC`;
      params = [req.user.id];
    }
    const { rows } = await pool.query(sql, params);
    res.json({ submissions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/submissions/:id/approve  (admin)
router.post('/:id/approve', authRequired, adminRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM submissions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const sub = rows[0];
    if (sub.status !== 'pending') return res.status(400).json({ error: 'not pending' });

    // Create content record from submission
    const sourceId = await getSourceId('github').catch(() => null) || 1;
    const raw = {
      source_item_id: `submission:${sub.id}`,
      type: sub.content_type,
      title: sub.title,
      description: sub.description,
      license: sub.license || 'Unknown',
      platform: [],
      download_url: sub.url,
      homepage_url: sub.url,
      tags: ['community-submitted'],
      updated_at: new Date().toISOString(),
      is_redistributable: false,
    };
    const norm = normalize(raw);
    const categoryId = await getCategoryId(norm.category_slug);
    const contentId = await upsertContent({ ...norm, source_id: sourceId, category_id: categoryId });

    await pool.query(`
      UPDATE submissions SET status = 'approved', reviewed_by = $1, reviewed_at = now(), content_id = $2 WHERE id = $3
    `, [req.user.id, contentId, sub.id]);

    // enqueue for VT scan
    await enqueueModeration(contentId);
    res.json({ ok: true, contentId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/submissions/:id/reject  (admin)
router.post('/:id/reject', authRequired, adminRequired, async (req, res) => {
  try {
    const { note } = req.body || {};
    await pool.query(`
      UPDATE submissions SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_note = $2 WHERE id = $3
    `, [req.user.id, note || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
