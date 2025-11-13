/**
 * Chunking utilities for large document processing
 * Splits text into manageable chunks based on token limits and natural boundaries
 */

export interface Chunk {
  idx: number;
  text: string;
  start: number; // character position in original text
  end: number; // character position in original text
  summary?: string; // optional contextual summary (unused in MVP)
}

/**
 * Estimate token count using heuristic: 1 token ≈ 4 characters
 * This is a rough approximation for Claude models (English legal text)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Determine if document needs chunking based on token threshold
 * @param text - Full extracted text
 * @param threshold - Token threshold (default: 4000 from CHUNK_TOKEN_LIMIT)
 * @returns true if text exceeds threshold
 */
export function needsChunking(text: string, threshold: number = 4000): boolean {
  return estimateTokens(text) > threshold;
}

/**
 * Split text into chunks respecting token limits and natural boundaries
 * @param text - Full extracted text
 * @param maxTokens - Maximum tokens per chunk (default: 4000)
 * @param overlapChars - Character overlap between chunks (default: 200)
 * @returns Array of chunks with metadata
 */
export function chunkText(
  text: string,
  maxTokens: number = 4000,
  overlapChars: number = 200
): Chunk[] {
  const maxChars = maxTokens * 4; // Convert tokens to approximate characters
  const chunks: Chunk[] = [];

  if (text.length <= maxChars) {
    // Text fits in single chunk
    return [
      {
        idx: 0,
        text,
        start: 0,
        end: text.length,
      },
    ];
  }

  let currentIdx = 0;
  let currentPos = 0;

  while (currentPos < text.length) {
    // Calculate where this chunk should start (with overlap for non-first chunks)
    const chunkStart =
      currentIdx > 0 ? Math.max(0, currentPos - overlapChars) : currentPos;

    const remainingText = text.substring(chunkStart);
    const targetLength = maxChars;

    // Strategy: Find best split point respecting natural boundaries
    let chunkEnd = text.length;
    let chunkText = "";

    if (remainingText.length <= targetLength) {
      // Remaining text fits in one chunk
      chunkText = remainingText;
      chunkEnd = text.length;
    } else {
      // Find best split point within target length
      const searchWindow = Math.min(targetLength, remainingText.length);
      let splitPos = searchWindow;

      // Try to split at paragraph boundary (double newline)
      const paraBreak = remainingText.lastIndexOf("\n\n", searchWindow);
      if (paraBreak > targetLength * 0.5) {
        // Found paragraph break in reasonable position
        splitPos = paraBreak + 2; // Include the newlines
      } else {
        // Try single newline
        const lineBreak = remainingText.lastIndexOf("\n", searchWindow);
        if (lineBreak > targetLength * 0.5) {
          splitPos = lineBreak + 1;
        } else {
          // Try sentence boundary (period + space)
          const sentenceBreak = remainingText.lastIndexOf(". ", searchWindow);
          if (sentenceBreak > targetLength * 0.5) {
            splitPos = sentenceBreak + 2;
          } else {
            // Hard split at target length
            splitPos = searchWindow;
          }
        }
      }

      chunkText = remainingText.substring(0, splitPos);
      chunkEnd = chunkStart + splitPos;
    }

    chunks.push({
      idx: currentIdx,
      text: chunkText.trim(),
      start: chunkStart,
      end: chunkEnd,
    });

    // Move position forward to end of this chunk (without overlap)
    // Next chunk will include overlap from this chunk's end
    currentPos = chunkEnd;
    currentIdx++;
  }

  return chunks;
}
