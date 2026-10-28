import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { indexExists, buildIndex } from './indexer.js';
import { retrieveRelevantChunks } from './retriever.js';
import { askGemini } from './llm.js';

/**
 * Main application runner.
 * 1. Checks if vector store exists (or if --reindex was passed).
 * 2. Indexes documents if needed.
 * 3. Starts the terminal Q&A loop using Node.js built-in readline.
 */
async function main() {
  const shouldReindex = process.argv.includes('--reindex');
  const exists = await indexExists();

  console.log(`========================================`);
  console.log(`       Gemini RAG Assistant (CLI)       `);
  console.log(`========================================\n`);

  try {
    if (shouldReindex || !exists) {
      if (shouldReindex) {
        console.log(`[Main] Reindexing requested...`);
      } else {
        console.log(`[Main] No existing vector store found. Building initial index...`);
      }

      const success = await buildIndex();
      if (!success) {
        console.log(
          `\n[Notice] Could not initialize vector index because no documents are available in docs/.\n` +
          `Add your .txt, .md, or .pdf files to the "docs/" folder and run "npm start" again.\n`
        );
        process.exit(0);
      }
    } else {
      console.log(`[Main] Existing vector store found at ./vector_store/index.json.`);
      console.log(`[Main] Skipping indexing. (To rebuild the index at any time, run: npm run reindex)\n`);
    }
  } catch (err) {
    console.error(`\n[Fatal Error during initialization]:\n${err.message}\n`);
    process.exit(1);
  }

  // Set up the terminal readline interface
  const rl = readline.createInterface({ input, output });

  console.log(`------------------------------------------------------------`);
  console.log(`Ready for questions!`);
  console.log(`Type your question and press Enter. (Type "exit" to quit)`);
  console.log(`------------------------------------------------------------\n`);

  // Interactive Question & Answer Loop
  while (true) {
    try {
      const question = await rl.question('Question: ');
      const trimmedQuestion = question.trim();

      // Skip blank inputs
      if (!trimmedQuestion) {
        continue;
      }

      // Check for exit commands
      if (trimmedQuestion.toLowerCase() === 'exit' || trimmedQuestion.toLowerCase() === 'quit') {
        console.log('\nExiting Gemini RAG Assistant. Goodbye!');
        rl.close();
        break;
      }

      console.log(`\nSearching for relevant context...`);
      // Retrieve top 4 most relevant chunks via cosine similarity
      const { chunks, sources } = await retrieveRelevantChunks(trimmedQuestion, 4);

      if (chunks.length === 0) {
        console.log(`\nAnswer:`);
        console.log(`I don't know based on the documents.`);
        console.log(`\nSources:`);
        console.log(`(None)\n`);
        continue;
      }

      console.log(`Querying Gemini with retrieved context...`);
      // Ask Gemini using strict context-only prompt
      const answer = await askGemini(trimmedQuestion, chunks);

      // Print answer
      console.log(`\nAnswer:`);
      console.log(answer);

      // Print source filenames
      console.log(`\nSources:`);
      if (sources.length > 0) {
        sources.forEach((src) => console.log(`- ${src}`));
      } else {
        console.log(`(None)`);
      }
      console.log(`\n------------------------------------------------------------\n`);
    } catch (err) {
      console.error(`\n[Error processing question]: ${err.message}\n`);
    }
  }
}

// Start application
main();

