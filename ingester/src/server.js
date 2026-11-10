import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import contentRoutes from './api/routes/content.js';
import authRoutes from './api/routes/auth.js';
import savedRoutes from './api/routes/saved.js';
import submissionRoutes from './api/routes/submissions.js';
import { authRequired } from './api/middleware/auth.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/content', contentRoutes);
app.use('/api/auth', authRoutes);
app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: req.user }));
app.use('/api/saved', savedRoutes);
app.use('/api/submissions', submissionRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('FreeHub API listening on :' + PORT));
