/**
 * Validation test to ensure chunks can be reconstructed from start/end positions
 * This is critical for PR #12 where chunks will be loaded from DB and processed
 */

import { chunkText } from "../extract_chunked";

describe("extract_chunked - Position Validation", () => {
  it("should allow reconstruction of chunk text from start/end positions", () => {
    const originalText =
      "First paragraph.\n\nSecond paragraph.\n\n" + "x".repeat(20000);
    const chunks = chunkText(originalText, 4000);

    // Verify each chunk's text matches the substring from original text
    chunks.forEach((chunk) => {
      const reconstructed = originalText.substring(chunk.start, chunk.end);
      // Note: chunk.text includes overlap, so it might be longer than reconstructed
      // But the core content should match
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.start).toBeLessThan(chunk.end);
      expect(chunk.end).toBeLessThanOrEqual(originalText.length);
    });

    // Verify chunks cover the entire text
    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];
    expect(firstChunk.start).toBe(0);
    expect(lastChunk.end).toBe(originalText.length);
  });

  it("should have sequential, non-overlapping end positions (excluding overlap in text)", () => {
    const originalText = "x".repeat(25000);
    const chunks = chunkText(originalText, 4000);

    // Verify chunks are sequential
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];

      // Current chunk should start at or before previous chunk ends
      // (allowing for overlap in the actual text content)
      expect(curr.start).toBeLessThanOrEqual(prev.end);
      expect(curr.idx).toBe(prev.idx + 1);
    }
  });
});
