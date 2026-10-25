/**
 * Splits plain text into chunks based on word count with a specified overlap.
 *
 * @param {string} text - The input text to chunk.
 * @param {number} [chunkSize=500] - Target number of words per chunk (~500 words).
 * @param {number} [overlap=50] - Number of overlapping words between consecutive chunks.
 * @returns {string[]} An array of text chunk strings.
 */
export function chunkText(text, chunkSize = 500, overlap = 50) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Split text by any whitespace sequence into individual words
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  // If text is within the chunk size limit, return as a single chunk
  if (words.length <= chunkSize) {
    return [words.join(' ')];
  }

  const chunks = [];
  // Calculate how many words to advance for each subsequent chunk
  const step = Math.max(1, chunkSize - overlap);

  for (let i = 0; i < words.length; i += step) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(' '));

    // Stop if the current slice reached the end of the document
    if (i + chunkSize >= words.length) {
      break;
    }
  }

  return chunks;
}

/**
 * Chunks an array of loaded documents into structured chunk objects.
 *
 * @param {Array<{ id: string, filename: string, text: string }>} docs
 * @param {number} [chunkSize=500] - Words per chunk.
 * @param {number} [overlap=50] - Overlap in words.
 * @returns {Array<{ id: string, source: string, text: string }>}
 */
export function chunkDocuments(docs, chunkSize = 500, overlap = 50) {
  const allChunks = [];

  for (const doc of docs) {
    const textChunks = chunkText(doc.text, chunkSize, overlap);

    textChunks.forEach((chunkText, index) => {
      allChunks.push({
        id: `${doc.id}#chunk-${index + 1}`,
        source: doc.filename,
        text: chunkText,
      });
    });
  }

  return allChunks;
}

