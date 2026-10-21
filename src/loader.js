import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Supported file extensions for document loading.
 */
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.xlsx', '.xls']);

/**
 * Extracts plain text from a PDF Buffer.
 * Supports both pdf-parse v1 (function export) and v2+ (PDFParse class).
 *
 * @param {Buffer} buffer - Raw file buffer of the PDF.
 * @returns {Promise<string>} Extracted text.
 */
async function parsePdfBuffer(buffer) {
  const pdfModule = await import('pdf-parse');

  // Case 1: Standard function default export (v1.x: import pdf from 'pdf-parse')
  if (typeof pdfModule.default === 'function') {
    const data = await pdfModule.default(buffer);
    return data.text || '';
  }

  // Case 2: Direct function export
  if (typeof pdfModule === 'function') {
    const data = await pdfModule(buffer);
    return data.text || '';
  }

  // Case 3: Class export (v2.x: new PDFParse({ data }))
  if (pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      if (typeof parser.destroy === 'function') {
        await parser.destroy();
      }
    }
  }

  throw new Error('Unrecognized pdf-parse module format.');
}

/**
 * Extracts text from an Excel (.xlsx / .xls) buffer.
 * Each sheet is converted to CSV format for structured, readable tabular context.
 *
 * @param {Buffer} buffer - Raw file buffer of the Excel spreadsheet.
 * @returns {Promise<string>}
 */
async function parseExcelBuffer(buffer) {
  const XLSX = await import('xlsx');
  const readFn = XLSX.read || XLSX.default?.read;
  const utils = XLSX.utils || XLSX.default?.utils;

  if (!readFn || !utils) {
    throw new Error('Unable to access XLSX read/utils functions.');
  }

  const workbook = readFn(buffer, { type: 'buffer' });
  const sheetTexts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = utils.sheet_to_csv(sheet);
    if (csv && csv.trim().length > 0) {
      sheetTexts.push(`[Worksheet: ${sheetName}]\n${csv.trim()}`);
    }
  }

  return sheetTexts.join('\n\n');
}

/**
 * Loads all supported documents (.txt, .md, .pdf, .xlsx, .xls) from the specified directory or directories.
 * Checks both `docs/` and `data/` by default so files in either folder are recognized.
 *
 * @param {string | string[]} [targetDirs='./docs'] - Directory or directories containing documents.
 * @returns {Promise<Array<{ id: string, filename: string, text: string }>>}
 */
export async function loadDocuments(targetDirs = './docs') {
  const dirsToCheck = Array.isArray(targetDirs) ? [...targetDirs] : [targetDirs];

  // If using default './docs', also check if './data' directory exists
  if (dirsToCheck.length === 1 && dirsToCheck[0] === './docs') {
    try {
      const dataStat = await fs.stat(path.resolve('./data'));
      if (dataStat.isDirectory()) {
        dirsToCheck.push('./data');
      }
    } catch {
      // ./data does not exist, continue with ./docs
    }
  }

  const loadedDocs = [];
  const processedFiles = new Set();

  for (const dir of dirsToCheck) {
    const resolvedDir = path.resolve(dir);

    // Check directory existence
    try {
      const stats = await fs.stat(resolvedDir);
      if (!stats.isDirectory()) {
        continue;
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (dir === './docs') {
          console.warn(`[Loader] Docs directory "${dir}" does not exist. Creating it now...`);
          await fs.mkdir(resolvedDir, { recursive: true });
        }
        continue;
      }
      throw err;
    }

    const fileNames = await fs.readdir(resolvedDir);

    for (const fileName of fileNames) {
      // Prevent duplicate processing if same file name appears
      if (processedFiles.has(fileName)) {
        continue;
      }

      const filePath = path.join(resolvedDir, fileName);
      const fileStat = await fs.stat(filePath);
      if (fileStat.isDirectory()) {
        continue;
      }

      const ext = path.extname(fileName).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        console.log(`[Loader] Skipping unsupported file: ${fileName} (extension ${ext || 'none'} not supported)`);
        continue;
      }

      try {
        if (ext === '.txt' || ext === '.md') {
          // Read plain text and markdown
          const content = await fs.readFile(filePath, 'utf-8');
          const trimmed = content.trim();
          if (trimmed.length > 0) {
            loadedDocs.push({ id: fileName, filename: fileName, text: trimmed });
            processedFiles.add(fileName);
          } else {
            console.warn(`[Loader] Skipping empty file: ${fileName}`);
          }
        } else if (ext === '.pdf') {
          // Read PDF
          const buffer = await fs.readFile(filePath);
          const text = await parsePdfBuffer(buffer);
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            loadedDocs.push({ id: fileName, filename: fileName, text: trimmed });
            processedFiles.add(fileName);
          } else {
            console.warn(`[Loader] No readable text found in PDF: ${fileName}`);
          }
        } else if (ext === '.xlsx' || ext === '.xls') {
          // Read Excel spreadsheet
          const buffer = await fs.readFile(filePath);
          const text = await parseExcelBuffer(buffer);
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            loadedDocs.push({ id: fileName, filename: fileName, text: trimmed });
            processedFiles.add(fileName);
            console.log(`[Loader] Parsed spreadsheet: ${fileName}`);
          } else {
            console.warn(`[Loader] No data found in spreadsheet: ${fileName}`);
          }
        }
      } catch (err) {
        console.error(`[Loader] Error reading "${fileName}": ${err.message}. Skipping this file.`);
      }
    }
  }

  return loadedDocs;
}
