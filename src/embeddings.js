import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

/**
 * Constant for the embedding model as specified in requirements.
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Validates the Gemini API key and initializes the GoogleGenAI client.
 * Throws a clean, actionable error message if the key is missing.
 *
 * @returns {GoogleGenAI}
 */
export function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (
    !apiKey ||
    apiKey.trim() === '' ||
    apiKey.trim() === 'your-key-here' ||
    apiKey.trim() === 'your-gemini-api-key-here'
  ) {
    throw new Error(
      'Missing or placeholder GEMINI_API_KEY.\n' +
      'Please create a .env file and set GEMINI_API_KEY to a valid Google Gemini API key.'
    );
  }

  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/**
 * Helper to execute an async API operation with a single retry on rate limit errors.
 *
 * @template T
 * @param {() => Promise<T>} apiCallFn - Function returning the API call promise.
 * @param {number} [retryDelayMs=3000] - Milliseconds to wait before retrying once.
 * @returns {Promise<T>}
 */
export async function callWithRetry(apiCallFn, retryDelayMs = 3000) {
  try {
    return await apiCallFn();
  } catch (err) {
    const errorMsg = String(err?.message || err);
    const status = err?.status || err?.code;

    // Detect rate limit errors (HTTP 429, RESOURCE_EXHAUSTED, or quota exceeded)
    const isRateLimit =
      status === 429 ||
      errorMsg.includes('429') ||
      errorMsg.includes('RESOURCE_EXHAUSTED') ||
      errorMsg.toLowerCase().includes('rate limit') ||
      errorMsg.toLowerCase().includes('quota');

    if (isRateLimit) {
      console.warn(`[Gemini API] Rate limit hit. Retrying once after ${retryDelayMs / 1000}s pause...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return await apiCallFn();
    }

    throw err;
  }
}

/**
 * Embeds a single text string (used for user questions during retrieval).
 *
 * @param {string} text - The input query string.
 * @returns {Promise<number[]>} Array of floating-point numbers representing the embedding vector.
 */
export async function embedQuery(text) {
  const ai = getGenAIClient();

  return await callWithRetry(async () => {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    const values = response.embeddings?.[0]?.values || response.embedding?.values;
    if (!values) {
      throw new Error('Gemini API returned an empty embedding response.');
    }

    return values;
  });
}

/**
 * Embeds an array of texts in batches to respect Gemini rate limits.
 *
 * @param {string[]} texts - Array of chunk text strings.
 * @param {number} [batchSize=10] - Number of chunks per batch.
 * @param {(completed: number, total: number) => void} [onProgress] - Optional callback for progress display.
 * @returns {Promise<number[][]>} Array of embedding vectors matching the input texts.
 */
export async function embedBatchTexts(texts, batchSize = 10, onProgress = null) {
  if (!texts || texts.length === 0) {
    return [];
  }

  const ai = getGenAIClient();
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const batchVectors = await callWithRetry(async () => {
      try {
        // Attempt batch embedding call
        const response = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch,
        });

        if (Array.isArray(response.embeddings) && response.embeddings.length === batch.length) {
          return response.embeddings.map((e) => e.values);
        }
      } catch (batchErr) {
        // If batch call encounters a non-rate-limit format issue, fall back to individual requests
        const isRateLimit =
          String(batchErr?.message || '').includes('429') ||
          String(batchErr?.message || '').includes('RESOURCE_EXHAUSTED');
        if (isRateLimit) throw batchErr;
      }

      // Fallback: embed texts individually within the batch
      const singleVectors = [];
      for (const text of batch) {
        const res = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: text,
        });
        const values = res.embeddings?.[0]?.values || res.embedding?.values;
        if (!values) {
          throw new Error('Could not extract embedding values for text item.');
        }
        singleVectors.push(values);
      }
      return singleVectors;
    });

    allEmbeddings.push(...batchVectors);

    if (typeof onProgress === 'function') {
      onProgress(Math.min(i + batchSize, texts.length), texts.length);
    }

    // Gentle delay between batches to stay well within free-tier requests-per-minute limits
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return allEmbeddings;
}

