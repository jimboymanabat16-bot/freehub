import express from 'express';
import { pool } from '../../db.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
router.use(authRequired);

// GET /api/saved?list=favorites
router.get('/', async (req, res) => {
  try {
    const list = req.query.list || 'favorites';
    const { rows } = await pool.query(`
      SELECT c.* FROM saved_items s JOIN content_view c ON c.id = s.content_id
      WHERE s.user_id = $1 AND s.list_name = $2 ORDER BY s.created_at DESC
    `, [req.user.id, list]);
    res.json({ items: rows, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saved  { contentId, list? }
router.post('/', async (req, res) => {
  try {
    const { contentId, list = 'favorites' } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId required' });
    await pool.query(
      `INSERT INTO saved_items (user_id, content_id, list_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.user.id, contentId, list]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/saved/:contentId?list=favorites
router.delete('/:contentId', async (req, res) => {
  try {
    const list = req.query.list || 'favorites';
    await pool.query(
      `DELETE FROM saved_items WHERE user_id = $1 AND content_id = $2 AND list_name = $3`,
      [req.user.id, req.params.contentId, list]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/saved/lists
router.get('/lists', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT list_name, COUNT(*)::int AS count FROM saved_items WHERE user_id = $1 GROUP BY list_name`,
      [req.user.id]
    );
    res.json({ lists: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alerts
router.get('/alerts', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ alerts: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts', async (req, res) => {
  try {
    const { query, category, license } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO alerts (user_id, query, category, license) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, query || null, category || null, license || null]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/alerts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
