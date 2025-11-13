/**
 * Unit tests for merge.ts
 */

import { mergeChunks, ChunkResult } from "../merge";

describe("merge", () => {
  describe("mergeChunks", () => {
    it("should return empty string for empty array", () => {
      expect(mergeChunks([])).toBe("");
    });

    it("should return single chunk text", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "Single chunk content." },
      ];
      expect(mergeChunks(results)).toBe("Single chunk content.");
    });

    it("should merge multiple chunks with paragraph breaks", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "First chunk content." },
        { idx: 1, text: "Second chunk content." },
        { idx: 2, text: "Third chunk content." },
      ];
      const merged = mergeChunks(results);
      expect(merged).toContain("First chunk content.");
      expect(merged).toContain("Second chunk content.");
      expect(merged).toContain("Third chunk content.");
      // Should have paragraph breaks
      expect(merged).toMatch(/\n\n/);
    });

    it("should handle chunks in any order (sort by idx)", () => {
      const results: ChunkResult[] = [
        { idx: 2, text: "Third chunk." },
        { idx: 0, text: "First chunk." },
        { idx: 1, text: "Second chunk." },
      ];
      const merged = mergeChunks(results);
      expect(merged.indexOf("First chunk.")).toBeLessThan(
        merged.indexOf("Second chunk.")
      );
      expect(merged.indexOf("Second chunk.")).toBeLessThan(
        merged.indexOf("Third chunk.")
      );
    });

    it("should deduplicate overlapping sentences at boundaries", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "Content with overlap. This sentence repeats." },
        { idx: 1, text: "This sentence repeats. New content here." },
      ];
      const merged = mergeChunks(results);

      // Should only have one instance of the repeated sentence
      const matches = merged.match(/This sentence repeats\./g);
      expect(matches).toHaveLength(1);
    });

    it("should handle chunks with no overlap", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "First unique content." },
        { idx: 1, text: "Second unique content." },
      ];
      const merged = mergeChunks(results);
      expect(merged).toContain("First unique content.");
      expect(merged).toContain("Second unique content.");
    });

    it("should preserve paragraph structure", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "Paragraph one.\n\nParagraph two." },
        { idx: 1, text: "Paragraph three.\n\nParagraph four." },
      ];
      const merged = mergeChunks(results);
      expect(merged).toContain("Paragraph one.");
      expect(merged).toContain("Paragraph four.");
    });

    it("should handle empty chunks", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "First chunk." },
        { idx: 1, text: "" },
        { idx: 2, text: "Third chunk." },
      ];
      const merged = mergeChunks(results);
      expect(merged).toContain("First chunk.");
      expect(merged).toContain("Third chunk.");
    });

    it("should trim final output", () => {
      const results: ChunkResult[] = [
        { idx: 0, text: "  First chunk.  " },
        { idx: 1, text: "  Second chunk.  " },
      ];
      const merged = mergeChunks(results);
      expect(merged).not.toMatch(/^\s/); // Should not start with whitespace
      expect(merged).not.toMatch(/\s$/); // Should not end with whitespace
    });

    it("should handle complex legal text with multiple sentences", () => {
      const results: ChunkResult[] = [
        {
          idx: 0,
          text: "This is a demand letter. It contains legal language. The client seeks compensation.",
        },
        {
          idx: 1,
          text: "The client seeks compensation. We request immediate payment. Failure to comply will result in legal action.",
        },
      ];
      const merged = mergeChunks(results);

      // Should deduplicate "The client seeks compensation."
      const matches = merged.match(/The client seeks compensation\./g);
      expect(matches).toHaveLength(1);

      // Should contain all unique content
      expect(merged).toContain("This is a demand letter.");
      expect(merged).toContain("We request immediate payment.");
      expect(merged).toContain(
        "Failure to comply will result in legal action."
      );
    });

    it("should handle many chunks", () => {
      const results: ChunkResult[] = Array.from({ length: 10 }, (_, i) => ({
        idx: i,
        text: `Chunk ${i} content.`,
      }));
      const merged = mergeChunks(results);

      for (let i = 0; i < 10; i++) {
        expect(merged).toContain(`Chunk ${i} content.`);
      }
    });
  });
});
