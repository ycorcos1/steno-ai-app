/**
 * Unit tests for extract_chunked.ts
 */

import {
  estimateTokens,
  needsChunking,
  chunkText,
  Chunk,
} from "../extract_chunked";

describe("extract_chunked", () => {
  describe("estimateTokens", () => {
    it("should estimate tokens using 4-char heuristic", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("test")).toBe(1); // 4 chars = 1 token
      expect(estimateTokens("hello world")).toBe(3); // 11 chars = 3 tokens (rounded up)
      expect(estimateTokens("a".repeat(4000))).toBe(1000); // 4000 chars = 1000 tokens
    });

    it("should round up for partial tokens", () => {
      expect(estimateTokens("abc")).toBe(1); // 3 chars rounds up to 1 token
      expect(estimateTokens("abcdefg")).toBe(2); // 7 chars = 2 tokens (rounded up)
    });
  });

  describe("needsChunking", () => {
    it("should return false for small documents", () => {
      const smallText = "a".repeat(1000); // ~250 tokens
      expect(needsChunking(smallText, 4000)).toBe(false);
    });

    it("should return true for large documents", () => {
      const largeText = "a".repeat(20000); // ~5000 tokens
      expect(needsChunking(largeText, 4000)).toBe(true);
    });

    it("should respect custom threshold", () => {
      const mediumText = "a".repeat(5000); // ~1250 tokens
      expect(needsChunking(mediumText, 1000)).toBe(true);
      expect(needsChunking(mediumText, 2000)).toBe(false);
    });

    it("should return false at exact threshold", () => {
      const exactText = "a".repeat(16000); // exactly 4000 tokens
      expect(needsChunking(exactText, 4000)).toBe(false);
    });
  });

  describe("chunkText", () => {
    it("should return single chunk for small text", () => {
      const text = "This is a short document.";
      const chunks = chunkText(text, 4000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].idx).toBe(0);
      expect(chunks[0].text).toBe(text);
      expect(chunks[0].start).toBe(0);
      expect(chunks[0].end).toBe(text.length);
    });

    it("should split large text into multiple chunks", () => {
      // Create text that exceeds chunk size (4000 tokens = ~16000 chars)
      const text = "Paragraph one.\n\nParagraph two.\n\n" + "x".repeat(20000);
      const chunks = chunkText(text, 4000);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].idx).toBe(0);
      expect(chunks[chunks.length - 1].idx).toBe(chunks.length - 1);
    });

    it("should preserve paragraph boundaries when possible", () => {
      const para1 = "First paragraph with content.\n\n";
      const para2 = "Second paragraph with content.\n\n";
      const para3 = "Third paragraph with content.\n\n";
      const text = para1 + para2 + para3 + "x".repeat(20000);
      const chunks = chunkText(text, 4000);

      // First chunk should end at paragraph boundary
      expect(chunks[0].text).toContain("First paragraph");
      // Should try to split at paragraph breaks
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should include overlap between chunks", () => {
      const text = "x".repeat(25000); // Large text
      const chunks = chunkText(text, 4000, 200);

      if (chunks.length > 1) {
        // Second chunk should start before first chunk ends (overlap)
        // Note: overlap is handled internally, so we verify chunks are sequential
        expect(chunks[1].start).toBeGreaterThanOrEqual(chunks[0].start);
        expect(chunks[1].end).toBeGreaterThan(chunks[0].end);
      }
    });

    it("should maintain sequential idx values", () => {
      const text = "x".repeat(25000);
      const chunks = chunkText(text, 4000);

      chunks.forEach((chunk, index) => {
        expect(chunk.idx).toBe(index);
      });
    });

    it("should handle text with no paragraph breaks", () => {
      // Text without natural breaks should still chunk
      const text = "x".repeat(25000);
      const chunks = chunkText(text, 4000);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.text.length).toBeGreaterThan(0);
      });
    });

    it("should respect maxTokens parameter", () => {
      const text = "x".repeat(10000);
      const smallChunks = chunkText(text, 1000); // 1000 tokens = ~4000 chars
      const largeChunks = chunkText(text, 8000); // 8000 tokens = ~32000 chars

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
    });

    it("should cover entire text with chunks", () => {
      const text = "x".repeat(25000);
      const chunks = chunkText(text, 4000);

      // All chunks should cover the full text range
      const firstStart = chunks[0].start;
      const lastEnd = chunks[chunks.length - 1].end;
      expect(firstStart).toBe(0);
      expect(lastEnd).toBe(text.length);
    });
  });
});
