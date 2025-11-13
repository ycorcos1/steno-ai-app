import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import mammoth from "mammoth";

// pdf-parse is a CommonJS module - lazy load to avoid Lambda initialization issues
// Only import when actually needed for PDF parsing
let pdfParse:
  | ((buffer: Buffer) => Promise<{ text: string; [key: string]: any }>)
  | null = null;

function getPdfParse() {
  if (!pdfParse) {
    try {
      pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{
        text: string;
        [key: string]: any;
      }>;
    } catch (error) {
      throw new Error("PDF parsing not available in this environment");
    }
  }
  return pdfParse;
}

const s3Client = new S3Client({
  region: process.env.REGION || "us-east-1",
});

/**
 * Convert S3 stream to Buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Extract text from PDF using pdf-parse
 */
async function extractPDF(buffer: Buffer): Promise<string> {
  const pdfParser = getPdfParse();
  const data = await pdfParser(buffer);
  return data.text.trim();
}

/**
 * Extract text from DOCX using mammoth
 */
async function extractDOCX(buffer: Buffer): Promise<string> {
  try {
    // First, validate this is actually a DOCX file (ZIP signature)
    if (buffer.length < 4) {
      throw new Error("File is too small to be a valid DOCX file");
    }

    // DOCX files are ZIP archives - check for ZIP signature
    const zipSignature = buffer.readUInt32LE(0);
    if (zipSignature !== 0x04034b50 && zipSignature !== 0x504b0304) {
      // Not a ZIP file - might be old DOC format misidentified as DOCX
      throw new Error(
        "File does not appear to be a valid DOCX file. DOCX files must be ZIP archives. If this is an old DOC file, please convert it to DOCX format."
      );
    }

    const result = await mammoth.extractRawText({ buffer });

    // Validate that we got actual text, not binary data
    if (!result.value || result.value.trim().length === 0) {
      throw new Error("No text could be extracted from DOCX file");
    }

    // Check if result contains XML tags or ZIP structure indicators (suggests extraction failed)
    const extractedText = result.value;
    const xmlTags = extractedText.match(/<[^>]+>/g);
    if (
      extractedText.includes("[Content_Types].xml") ||
      extractedText.includes("_rels/.rels") ||
      extractedText.includes("docProps/") ||
      extractedText.includes("word/document.xml") ||
      (extractedText.includes("<?xml") && xmlTags && xmlTags.length > 10)
    ) {
      throw new Error(
        "Extraction failed - result appears to contain raw XML/ZIP structure. The file may be corrupted or mammoth failed to extract text properly."
      );
    }

    // Check if the result looks like binary data (contains too many non-printable chars)
    const nonPrintableCount = (
      extractedText.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) || []
    ).length;
    const totalChars = extractedText.length;
    if (totalChars > 0 && nonPrintableCount / totalChars > 0.1) {
      throw new Error(
        "Extracted content appears to be binary data. The file may be corrupted or in an unsupported format."
      );
    }

    // Check if result is mostly non-printable characters
    const printableChars = extractedText.replace(
      /[^\x20-\x7E\n\r\t]/g,
      ""
    ).length;
    const printableRatio = printableChars / extractedText.length;
    if (printableRatio < 0.5 && extractedText.length > 100) {
      throw new Error(
        "Extracted content contains too many non-printable characters. The file may be corrupted or in an unsupported format."
      );
    }

    return extractedText.trim();
  } catch (error: any) {
    // If mammoth fails, provide a helpful error
    if (error.message) {
      throw new Error(`Failed to extract text from DOCX: ${error.message}`);
    }
    throw new Error(
      "Failed to extract text from DOCX file. The file may be corrupted or password-protected."
    );
  }
}

/**
 * Extract text from DOC (old Microsoft Word format)
 * Note: Old DOC files are binary format and difficult to parse in Lambda.
 * This implementation attempts to extract readable text using multiple approaches.
 * For best results, users should convert DOC files to DOCX format.
 */
async function extractDOC(buffer: Buffer): Promise<string> {
  // Old DOC files (application/msword) are in a binary format that's difficult to parse
  // without native libraries. We'll attempt a basic text extraction by looking for
  // readable text sequences in the binary data.

  try {
    let bestText = "";
    let bestReadableCount = 0;

    // Try multiple extraction approaches
    const approaches = [
      // Approach 1: UTF-16 LE (common encoding in DOC files)
      () => {
        try {
          const text = buffer.toString("utf16le");
          const readable = text.replace(/[^\x20-\x7E\n\r\t]/g, "").length;
          return { text, readable };
        } catch {
          return { text: "", readable: 0 };
        }
      },
      // Approach 2: Latin1 with ASCII filtering
      () => {
        const text = buffer.toString("latin1");
        // Find sequences of printable ASCII (at least 4 chars)
        const matches = text.match(/[\x20-\x7E]{4,}/g) || [];
        const combined = matches.join(" ");
        const readable = combined.replace(/[^\x20-\x7E]/g, "").length;
        return { text: combined, readable };
      },
      // Approach 3: Look for text between null bytes (common in DOC structure)
      () => {
        const text = buffer.toString("latin1");
        // Split by null bytes and extract readable chunks
        const chunks = text.split(/\x00+/);
        const readableChunks = chunks
          .map((chunk) => chunk.replace(/[^\x20-\x7E]/g, ""))
          .filter((chunk) => chunk.length >= 4);
        const combined = readableChunks.join(" ");
        const readable = combined.length;
        return { text: combined, readable };
      },
    ];

    // Try each approach and keep the best result
    for (const approach of approaches) {
      const result = approach();
      if (result.readable > bestReadableCount) {
        bestReadableCount = result.readable;
        bestText = result.text;
      }
    }

    // Clean up the extracted text
    if (bestText.length > 50) {
      const cleaned = bestText
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ") // Remove control chars except \n, \r, \t
        .replace(/[^\x20-\x7E\n\r\t]/g, " ") // Remove non-ASCII except newlines/tabs
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();

      // Check if result contains ZIP/XML structure (file might be DOCX misidentified as DOC)
      if (
        cleaned.includes("[Content_Types].xml") ||
        cleaned.includes("_rels/.rels") ||
        cleaned.includes("docProps/") ||
        cleaned.includes("word/document.xml")
      ) {
        throw new Error(
          "File appears to be a DOCX file (ZIP archive) but was identified as DOC format. Please ensure the file is correctly identified or convert it to DOCX format."
        );
      }

      // Validate we have actual readable text (not just file paths/structure)
      const printableChars = cleaned.replace(/[^\x20-\x7E]/g, "").length;
      const printableRatio = printableChars / cleaned.length;

      // Check if the text is mostly file paths/structure strings (common in ZIP extraction)
      const pathLikePatterns = (
        cleaned.match(/[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\.]+/g) || []
      ).length;
      const pathRatio = (pathLikePatterns * 20) / cleaned.length; // Rough estimate

      // If more than 30% looks like file paths, it's probably ZIP structure, not document text
      if (pathRatio > 0.3 && cleaned.length > 200) {
        throw new Error(
          "Extracted content appears to be file structure rather than document text. The file may be a DOCX file misidentified as DOC format. Please convert to DOCX format and try again."
        );
      }

      // For DOC files, be more lenient (at least 30% printable)
      if (cleaned.length > 50 && printableRatio > 0.3) {
        return cleaned;
      }
    }

    // If extraction didn't yield good results, throw a helpful error
    throw new Error(
      "Unable to extract text from DOC file. Old DOC format (application/msword) is not fully supported. Please convert the file to DOCX format and try again."
    );
  } catch (error: any) {
    if (
      error.message.includes("convert") ||
      error.message.includes("not fully supported")
    ) {
      throw error;
    }
    throw new Error(
      `Failed to extract text from DOC file. Old DOC format is not fully supported. Please convert to DOCX format: ${
        error.message || "Unknown error"
      }`
    );
  }
}

/**
 * Main extraction function - downloads from S3 and extracts text
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @param mimeType - MIME type of the file
 * @returns Extracted text content
 * @throws Error if file type is unsupported or extraction fails
 */
export async function extractText(
  bucket: string,
  key: string,
  mimeType: string
): Promise<string> {
  console.log(`Extracting text from ${key}, MIME type: ${mimeType}`);

  // Download file from S3
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error("No file content received from S3");
  }

  const buffer = await streamToBuffer(response.Body as Readable);
  console.log(`Downloaded file, size: ${buffer.length} bytes`);

  // Validate buffer is not empty
  if (buffer.length === 0) {
    throw new Error("Downloaded file is empty");
  }

  // Check if file is actually a DOCX (ZIP) but was misidentified as DOC
  if (mimeType === "application/msword") {
    const zipSignature = buffer.readUInt32LE(0);
    if (zipSignature === 0x04034b50 || zipSignature === 0x504b0304) {
      console.warn(
        `File ${key} is actually a DOCX (ZIP archive) but was identified as DOC. Attempting DOCX extraction.`
      );
      // Try DOCX extraction instead
      try {
        const docxText = await extractDOCX(buffer);
        console.log(
          `Successfully extracted ${docxText.length} characters using DOCX method`
        );
        return docxText;
      } catch (docxError: any) {
        throw new Error(
          `File appears to be DOCX format but DOCX extraction failed. Please ensure the file is correctly identified: ${docxError.message}`
        );
      }
    }
  }

  let extractedText: string;

  // Extract based on MIME type
  try {
    switch (mimeType) {
      case "application/pdf":
        extractedText = await extractPDF(buffer);
        break;

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        extractedText = await extractDOCX(buffer);
        break;

      case "application/msword":
        extractedText = await extractDOC(buffer);
        break;

      case "text/plain":
        extractedText = buffer.toString("utf-8").trim();
        break;

      default:
        throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Final validation - ensure we have actual text, not binary data
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("Text extraction returned empty result");
    }

    // Check if result looks like binary data (starts with ZIP signature "PK" or has too many control chars)
    // Skip this check for DOC files as they may have binary artifacts from the extraction process
    if (mimeType !== "application/msword") {
      if (
        extractedText.startsWith("PK") ||
        extractedText.startsWith("\x50\x4B")
      ) {
        throw new Error(
          "Extraction failed - result appears to be binary/ZIP data. The file may not have been processed correctly."
        );
      }

      // Additional check for DOCX files - detect XML/ZIP structure in extracted text
      if (
        mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        if (
          extractedText.includes("[Content_Types].xml") ||
          extractedText.includes("_rels/.rels") ||
          extractedText.includes("docProps/") ||
          extractedText.includes("word/document.xml")
        ) {
          throw new Error(
            "Extraction failed - result appears to contain raw XML/ZIP structure from DOCX file. The file may be corrupted or the extraction library failed."
          );
        }
      }
    }

    const nonPrintableRatio =
      (extractedText.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) || []).length /
      extractedText.length;
    // Be more lenient with DOC files as they may have more binary artifacts
    const threshold = mimeType === "application/msword" ? 0.15 : 0.05;
    if (nonPrintableRatio > threshold && extractedText.length > 100) {
      if (mimeType === "application/msword") {
        console.warn(
          `Warning: DOC file has high ratio of non-printable characters (${(
            nonPrintableRatio * 100
          ).toFixed(1)}%)`
        );
      } else {
        console.warn(
          `Warning: High ratio of non-printable characters (${(
            nonPrintableRatio * 100
          ).toFixed(1)}%)`
        );
      }
    }

    console.log(
      `Successfully extracted ${extractedText.length} characters of text`
    );
    return extractedText;
  } catch (error: any) {
    console.error(`Extraction failed for ${mimeType}:`, error);
    throw error;
  }
}
