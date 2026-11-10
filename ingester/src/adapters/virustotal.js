// VirusTotal scan worker.
// Scans download URLs of pending content items and updates risk_assessments.
// Free tier: 4 requests/min, 500/day. We scan by URL (no upload of files).

import { pool } from '../db.js';
import { upsertRisk } from '../db.js';

const VT_KEY = process.env.VIRUSTOTAL_API_KEY || '';
const VT_BASE = 'https://www.virustotal.com/api/v3';

async function vtFetch(path, options = {}) {
  if (!VT_KEY) throw new Error('VIRUSTOTAL_API_KEY not set');
  const res = await fetch(`${VT_BASE}${path}`, {
    ...options,
    headers: { 'x-apikey': VT_KEY, 'Accept': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 429) {
    // rate limited; caller should back off
    throw new Error('VT_RATE_LIMIT');
  }
  if (!res.ok) throw new Error(`VT ${res.status}: ${path}`);
  return res.json();
}

// Submit a URL for scanning; returns analysis id
async function submitUrl(url) {
  const body = new URLSearchParams({ url });
  const data = await vtFetch('/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return data?.data?.id;
}

// Get analysis result by id
async function getAnalysis(id) {
  return vtFetch(`/analyses/${id}`);
}

// Get URL report by url id (base64 url)
async function getUrlReport(url) {
  const id = Buffer.from(url).toString('base64').replace(/=/g, '');
  return vtFetch(`/urls/${id}`);
}

function deriveOverall(stats) {
  const malicious = stats?.malicious || 0;
  const suspicious = stats?.suspicious || 0;
  if (malicious > 0) return 'flagged';
  if (suspicious > 0) return 'caution';
  return 'verified';
}

export async function scanPending({ limit = 50 } = {}) {
  if (!VT_KEY) {
    console.warn('VIRUSTOTAL_API_KEY not set; skipping scans.');
    return [];
  }
  // Find content items with pending risk or never scanned, that have a real download_url
  const { rows } = await pool.query(`
    SELECT c.id, c.download_url, c.title, ra.overall AS current_overall
    FROM content c
    LEFT JOIN risk_assessments ra ON ra.content_id = c.id
    WHERE c.download_url IS NOT NULL
      AND c.download_url NOT LIKE '%#%'
      AND (ra.overall IS NULL OR ra.overall = 'pending' OR ra.last_scanned IS NULL)
    ORDER BY c.ingested_at DESC
    LIMIT $1
  `, [limit]);

  const results = [];
  for (const row of rows) {
    try {
      console.log(`Scanning: ${row.title}`);
      // Try to get existing report first (cheaper, no rate limit on cached)
      let report;
      try {
        report = await getUrlReport(row.download_url);
      } catch (e) {
        if (e.message === 'VT_RATE_LIMIT') throw e;
        // not found -> submit
        report = null;
      }

      let stats = report?.data?.attributes?.last_analysis_stats;
      if (!stats) {
        // submit and poll
        const analysisId = await submitUrl(row.download_url);
        if (!analysisId) throw new Error('no analysis id');
        // poll up to 5 times
        for (let i = 0; i < 5; i++) {
          await new Promise(res => setTimeout(res, 15000));
          const an = await getAnalysis(analysisId);
          const status = an?.data?.attributes?.status;
          if (status === 'completed') {
            stats = an?.data?.attributes?.stats;
            break;
          }
        }
      }
      if (!stats) {
        console.warn(`  no stats yet for ${row.title}`);
        continue;
      }

      const overall = deriveOverall(stats);
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      await upsertRisk(row.id, {
        overall,
        vt_positives: (stats.malicious || 0) + (stats.suspicious || 0),
        vt_total: total,
        vt_scan_date: new Date().toISOString(),
        is_signed: null,
        signer: null,
        license_clear: null,
        last_scanned: new Date().toISOString(),
        user_reports: 0,
      });

      results.push({ id: row.id, title: row.title, overall, positives: stats.malicious || 0 });
      console.log(`  -> ${overall} (${stats.malicious || 0}/${total})`);
      // free tier: 4 req/min -> wait 16s between calls
      await new Promise(res => setTimeout(res, 16000));
    } catch (e) {
      if (e.message === 'VT_RATE_LIMIT') {
        console.warn('Rate limited by VirusTotal; stopping scan batch.');
        break;
      }
      console.error(`  ✗ ${row.title}: ${e.message}`);
    }
  }
  console.log(`Scan done: ${results.length} items`);
  return results;
}

export default { scanPending };
