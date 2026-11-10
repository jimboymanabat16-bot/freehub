import { MeiliSearch } from 'meilisearch';
import dotenv from 'dotenv';
dotenv.config();

const client = new MeiliSearch({
  host: process.env.MEILI_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILI_API_KEY || '',
});

const INDEX = 'content';

export async function ensureIndex() {
  try {
    await client.createIndex(INDEX, { primaryKey: 'id' });
  } catch (e) {
    // already exists
  }
  const idx = client.index(INDEX);
  await idx.updateSettings({
    searchableAttributes: ['title', 'description', 'tags', 'license', 'platform'],
    filterableAttributes: ['content_type', 'license', 'platform', 'risk_overall', 'is_live'],
    sortableAttributes: ['avg_rating', 'total_downloads', 'updated_at', 'size_bytes'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  });
  return idx;
}

export async function indexContent(docs) {
  if (!docs.length) return;
  const idx = client.index(INDEX);
  await idx.addDocuments(docs);
}

export async function removeContent(id) {
  const idx = client.index(INDEX);
  await idx.deleteDocument(id);
}

export default { ensureIndex, indexContent, removeContent, client };
