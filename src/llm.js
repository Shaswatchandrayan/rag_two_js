import { getGenAIClient, callWithRetry } from './embeddings.js';

/**
 * Chat model constant as specified in requirements.
 * Kept in a constant, defaulting to 'gemini-2.5-flash'.
 */
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

/**
 * Constructs the prompt enforcing strict document-only answering.
 *
 * @param {string} question - The user's question.
 * @param {Array<{ source: string, text: string }>} contextChunks - Retrieved context chunks.
 * @returns {string}
 */
export function buildPrompt(question, contextChunks) {
  const contextString = contextChunks
    .map((chunk, idx) => `[Source: ${chunk.source} | Chunk ${idx + 1}]\n${chunk.text}`)
    .join('\n\n---\n\n');

  return `You are a helpful assistant answering questions based strictly on provided documentation.

Context:
${contextString}

Question:
${question}

Instructions:
Answer using ONLY the provided context; if the answer is not in the context, reply "I don't know based on the documents."
Do not make assumptions, invent facts, or utilize external knowledge not present in the context above. Keep the answer clear and concise.`;
}

/**
 * Calls Gemini using @google/genai to generate an answer based strictly on the retrieved chunks.
 *
 * @param {string} question - User question.
 * @param {Array<{ source: string, text: string }>} contextChunks - Top retrieved chunks.
 * @returns {Promise<string>} The generated answer text.
 */
export async function askGemini(question, contextChunks) {
  if (!contextChunks || contextChunks.length === 0) {
    return "I don't know based on the documents.";
  }

  const ai = getGenAIClient();
  const prompt = buildPrompt(question, contextChunks);

  let activeModel = CHAT_MODEL;

  return await callWithRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
      });

      const text = response.text ? response.text.trim() : '';
      return text || "I don't know based on the documents.";
    } catch (err) {
      const errorStr = JSON.stringify(err) + ' ' + (err?.message || '');
      // If gemini-2.5-flash is not available on current account/region, automatically fall back to gemini-3.8-flash
      if (
        (errorStr.includes('404') || errorStr.includes('NOT_FOUND')) &&
        activeModel === 'gemini-2.5-flash'
      ) {
        console.warn(`[LLM] Model "${activeModel}" returned NOT_FOUND. Automatically falling back to "gemini-3.8-flash"...`);
        activeModel = 'gemini-3.8-flash';
        const fallbackRes = await ai.models.generateContent({
          model: activeModel,
          contents: prompt,
        });
        const text = fallbackRes.text ? fallbackRes.text.trim() : '';
        return text || "I don't know based on the documents.";
      }
      throw err;
    }
  });
}
