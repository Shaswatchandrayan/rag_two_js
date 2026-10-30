import fs from 'node:fs/promises';
import path from 'node:path';
import { embedQuery } from './embeddings.js';

export const DEFAULT_STORE_DIR = './vector_store';
export const DEFAULT_INDEX_FILE = 'index.json';

/**
 * Hand-written Cosine Similarity function.
 * Computes the dot product of two vectors divided by the product of their Euclidean magnitudes.
 *
 * formula: (A · B) / (||A|| * ||B||)
 *
 * @param {number[]} vecA - First vector.
 * @param {number[]} vecB - Second vector.
 * @returns {number} Similarity score between -1.0 and 1.0.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Loads the vector store from `./vector_store/index.json`.
 *
 * @param {string} [storeDir=DEFAULT_STORE_DIR]
 * @param {string} [indexFile=DEFAULT_INDEX_FILE]
 * @returns {Promise<Array<{ id: string, source: string, text: string, embedding: number[] }>>}
 */
export async function loadVectorStore(storeDir = DEFAULT_STORE_DIR, indexFile = DEFAULT_INDEX_FILE) {
  const indexPath = path.join(path.resolve(storeDir), indexFile);

  try {
    const data = await fs.readFile(indexPath, 'utf-8');
    const records = JSON.parse(data);
    if (!Array.isArray(records)) {
      throw new Error('Vector index content is not a valid array.');
    }
    return records;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Vector store index not found at "${indexPath}". Please run indexing first.`);
    }
    throw err;
  }
}

/**
 * Embeds the user question, calculates cosine similarity against all stored chunks,
 * and returns the top K most relevant chunks (default: 4).
 *
 * @param {string} question - The user's query.
 * @param {number} [topK=4] - Number of top chunks to return.
 * @param {string} [storeDir=DEFAULT_STORE_DIR]
 * @param {string} [indexFile=DEFAULT_INDEX_FILE]
 * @returns {Promise<{ chunks: Array<{ id: string, source: string, text: string, score: number }>, sources: string[] }>}
 */
export async function retrieveRelevantChunks(
  question,
  topK = 4,
  storeDir = DEFAULT_STORE_DIR,
  indexFile = DEFAULT_INDEX_FILE
) {
  const records = await loadVectorStore(storeDir, indexFile);

  if (records.length === 0) {
    return { chunks: [], sources: [] };
  }

  // Embed the incoming user question
  const queryEmbedding = await embedQuery(question);

  // Compute similarity score for each chunk in the vector store
  const scoredChunks = records.map((record) => {
    const score = cosineSimilarity(queryEmbedding, record.embedding);
    return {
      id: record.id,
      source: record.source,
      text: record.text,
      score,
    };
  });

  // Sort chunks by score in descending order (highest similarity first)
  scoredChunks.sort((a, b) => b.score - a.score);

  // Take the top K chunks
  const topChunks = scoredChunks.slice(0, topK);

  // Extract unique source file names
  const uniqueSources = [...new Set(topChunks.map((chunk) => chunk.source))];

  return {
    chunks: topChunks,
    sources: uniqueSources,
  };
}

