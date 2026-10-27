import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocuments } from './loader.js';
import { chunkDocuments } from './chunker.js';
import { embedBatchTexts, EMBEDDING_MODEL } from './embeddings.js';

export const DEFAULT_DOCS_DIR = './docs';
export const DEFAULT_STORE_DIR = './vector_store';
export const DEFAULT_INDEX_FILE = 'index.json';

/**
 * Checks whether the vector index file already exists.
 *
 * @param {string} [storeDir=DEFAULT_STORE_DIR]
 * @param {string} [indexFile=DEFAULT_INDEX_FILE]
 * @returns {Promise<boolean>}
 */
export async function indexExists(storeDir = DEFAULT_STORE_DIR, indexFile = DEFAULT_INDEX_FILE) {
  try {
    const indexPath = path.join(path.resolve(storeDir), indexFile);
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads documents from the docs folder, chunks them, embeds each chunk with Gemini,
 * and writes the result to `./vector_store/index.json`.
 *
 * @param {object} [options]
 * @param {string} [options.docsDir=DEFAULT_DOCS_DIR]
 * @param {string} [options.storeDir=DEFAULT_STORE_DIR]
 * @param {string} [options.indexFile=DEFAULT_INDEX_FILE]
 * @returns {Promise<boolean>} True if indexing succeeded, false otherwise.
 */
export async function buildIndex({
  docsDir = DEFAULT_DOCS_DIR,
  storeDir = DEFAULT_STORE_DIR,
  indexFile = DEFAULT_INDEX_FILE,
} = {}) {
  console.log(`\n========================================`);
  console.log(`[Indexer] Starting document indexing...`);
  console.log(`========================================`);
  console.log(`[Indexer] Scanning directory: "${docsDir}"`);

  // Step 1: Load documents (.txt, .md, .pdf)
  const docs = await loadDocuments(docsDir);

  if (docs.length === 0) {
    console.warn(`[Indexer] No documents to index. Please add documents to "${docsDir}".`);
    return false;
  }

  console.log(`[Indexer] Loaded ${docs.length} document(s): ${docs.map((d) => d.filename).join(', ')}`);

  // Step 2: Chunk documents (~500 words per chunk, 50 word overlap)
  const chunks = chunkDocuments(docs, 500, 50);

  if (chunks.length === 0) {
    console.warn(`[Indexer] No text content found across documents to chunk.`);
    return false;
  }

  console.log(`[Indexer] Split into ${chunks.length} chunk(s) (approx. 500 words each with 50-word overlap).`);

  // Step 3: Embed chunks in batches with Gemini
  console.log(`[Indexer] Generating vector embeddings via "${EMBEDDING_MODEL}"...`);
  const textsToEmbed = chunks.map((c) => c.text);

  const embeddings = await embedBatchTexts(textsToEmbed, 10, (done, total) => {
    console.log(`[Indexer] Embedding progress: ${done}/${total} chunks embedded...`);
  });

  // Step 4: Construct vector records { id, source, text, embedding }
  const vectorRecords = chunks.map((chunk, i) => ({
    id: chunk.id,
    source: chunk.source,
    text: chunk.text,
    embedding: embeddings[i],
  }));

  // Step 5: Ensure ./vector_store directory exists and save index.json
  const resolvedStoreDir = path.resolve(storeDir);
  await fs.mkdir(resolvedStoreDir, { recursive: true });

  const resolvedIndexPath = path.join(resolvedStoreDir, indexFile);
  await fs.writeFile(resolvedIndexPath, JSON.stringify(vectorRecords, null, 2), 'utf-8');

  console.log(`[Indexer] Successfully indexed ${vectorRecords.length} chunk(s).`);
  console.log(`[Indexer] Vector store saved to: "${resolvedIndexPath}"\n`);

  return true;
}

// Allow direct execution: node src/indexer.js
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await buildIndex();
  } catch (err) {
    console.error(`[Indexer] Indexing failed: ${err.message}`);
    process.exit(1);
  }
}

