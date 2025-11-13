/**
 * Merge utilities for combining AI-generated chunk results
 * Ensures coherent output across chunk boundaries
 */

export interface ChunkResult {
  idx: number;
  text: string;
}

/**
 * Remove duplicate content at chunk boundaries
 * Detects overlapping sentences at the end of current chunk and start of next chunk
 * @param current - Current chunk text
 * @param next - Next chunk text
 * @param overlapWindow - Number of sentences to check for overlap (default: 2)
 * @returns Next chunk text with duplicates removed
 */
function deduplicateBoundaries(
  current: string,
  next: string,
  overlapWindow: number = 2
): string {
  if (!current || !next) {
    return next;
  }

  // Split into sentences (simple heuristic: period + space or newline)
  // Normalize by removing trailing periods for comparison
  const splitSentences = (text: string): string[] => {
    return text
      .split(/\.\s+/)
      .map((s) => s.trim().replace(/\.$/, "")) // Remove trailing period if present
      .filter((s) => s.length > 0);
  };

  const currentSentences = splitSentences(current);
  const nextSentences = splitSentences(next);

  if (currentSentences.length === 0 || nextSentences.length === 0) {
    return next;
  }

  // Check last N sentences of current against first N sentences of next
  const checkCount = Math.min(
    overlapWindow,
    currentSentences.length,
    nextSentences.length
  );

  // Find how many sentences overlap by comparing from the end of current to start of next
  let overlapCount = 0;
  for (let i = 0; i < checkCount; i++) {
    const currentSentenceIdx = currentSentences.length - 1 - i; // Last, second-to-last, etc.
    const nextSentenceIdx = i; // First, second, etc.

    if (currentSentenceIdx >= 0 && nextSentenceIdx < nextSentences.length) {
      const currentSentence = currentSentences[currentSentenceIdx]
        .toLowerCase()
        .trim();
      const nextSentence = nextSentences[nextSentenceIdx].toLowerCase().trim();

      if (currentSentence === nextSentence && currentSentence.length > 0) {
        overlapCount++;
      } else {
        break; // Stop at first non-match
      }
    } else {
      break;
    }
  }

  // Remove overlapping sentences from next chunk
  if (overlapCount > 0) {
    const sentencesToKeep = nextSentences.slice(overlapCount);
    if (sentencesToKeep.length === 0) {
      return ""; // All sentences were duplicates
    }
    // Join sentences with ". " and ensure last sentence has period
    const joined = sentencesToKeep.join(". ").trim();
    // Add period if not present (shouldn't happen after normalization, but be safe)
    return joined.endsWith(".") ? joined : joined + ".";
  }

  return next;
}

/**
 * Merge chunk results with section-aware logic
 * @param results - Array of chunk results in order (must be sorted by idx)
 * @returns Single merged text output
 */
export function mergeChunks(results: ChunkResult[]): string {
  if (results.length === 0) {
    return "";
  }

  if (results.length === 1) {
    return results[0].text;
  }

  // Sort by idx to ensure correct order
  const sorted = [...results].sort((a, b) => a.idx - b.idx);

  let merged = sorted[0].text;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i - 1].text;
    const next = sorted[i].text;

    // Remove duplicates at boundary
    const cleanedNext = deduplicateBoundaries(current, next);

    // Add paragraph break between chunks
    if (merged && !merged.endsWith("\n\n")) {
      merged += "\n\n";
    }

    merged += cleanedNext;
  }

  return merged.trim();
}
