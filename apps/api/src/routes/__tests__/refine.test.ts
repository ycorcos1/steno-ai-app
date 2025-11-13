/**
 * Unit tests for refine routes
 * Tests the refine, refinements list, and restore endpoints
 */

import express from "express";
import request from "supertest";
import axios from "axios";
import refineRouter from "../refine";
import { query } from "../../db/pg";

// Mock dependencies
jest.mock("../../db/pg");
jest.mock("axios");
jest.mock("../../middleware/auth", () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { userId: "test-user-id" };
    next();
  },
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAxios = axios as jest.Mocked<typeof axios>;

const app = express();
app.use(express.json());
app.use("/ai", refineRouter);
app.use("/documents", refineRouter);

describe("Refine Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /ai/refine", () => {
    it("should return 400 if documentId is missing", async () => {
      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-missing-doc")
        .send({ prompt: "Make it more formal" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required fields");
    });

    it("should return 400 if prompt is missing", async () => {
      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-missing-prompt")
        .send({ documentId: "doc-123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required fields");
    });

    it("should return 404 if document not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-404")
        .send({ documentId: "doc-123", prompt: "Refine this" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Document not found");
    });

    it("should return 400 if no draft exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "test-user-id", draft_text: null }],
      } as any);

      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-404")
        .send({ documentId: "doc-123", prompt: "Refine this" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("No draft to refine");
    });

    it("should return 400 if draft is empty", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-123",
            owner_id: "test-user-id",
            draft_text: "",
            status: "uploaded",
          },
        ],
      } as any);

      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-404")
        .send({ documentId: "doc-123", prompt: "Refine this" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("No draft to refine");
    });

    it("should successfully refine a draft", async () => {
      const originalDraft = "Original draft text";
      const refinedText = "Refined draft text";
      const refinementId = "refinement-123";

      // Mock document fetch
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-123",
            owner_id: "test-user-id",
            draft_text: originalDraft,
            status: "draft_generated",
          },
        ],
      } as any);

      // Mock AI service response
      mockAxios.post.mockResolvedValueOnce({
        data: { text: refinedText },
      } as any);

      // Mock refinement insert
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: refinementId }],
      } as any);

      // Mock document update
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-success")
        .send({ documentId: "doc-123", prompt: "Make it more formal" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.refinementId).toBe(refinementId);
      expect(response.body.draftText).toBe(refinedText);

      // Verify AI service was called
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/generate"),
        { prompt: expect.stringContaining(originalDraft) },
        { timeout: 60000 }
      );

      // Verify refinement was saved
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO refinements"),
        expect.arrayContaining(["doc-123", "Make it more formal", refinedText])
      );

      // Verify document was updated
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE documents"),
        expect.arrayContaining([refinedText, "doc-123"])
      );
    });

    it("should return 500 if AI service fails", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-123",
            owner_id: "test-user-id",
            draft_text: "Original draft",
            status: "draft_generated",
          },
        ],
      } as any);

      mockAxios.post.mockRejectedValueOnce(new Error("AI service unavailable"));

      const response = await request(app)
        .post("/ai/refine")
        .set("Idempotency-Key", "test-refine-404")
        .send({ documentId: "doc-123", prompt: "Refine this" });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Refinement failed");
    });
  });

  describe("GET /documents/:id/refinements", () => {
    it("should return 404 if document not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app).get("/documents/doc-123/refinements");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Document not found");
    });

    it("should return 403 if user is not owner or collaborator", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "other-user-id" }],
      } as any);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any); // No collaborator access

      const response = await request(app).get("/documents/doc-123/refinements");

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Access denied");
    });

    it("should return refinements for document owner", async () => {
      // Mock should return refinements in DESC order (newest first) as per SQL ORDER BY
      const refinements = [
        {
          id: "ref-2",
          prompt: "Add bullets",
          result: "Bulleted text",
          created_at: new Date("2024-01-02"),
        },
        {
          id: "ref-1",
          prompt: "Make it formal",
          result: "Formal text",
          created_at: new Date("2024-01-01"),
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "test-user-id" }],
      } as any);
      mockQuery.mockResolvedValueOnce({ rows: refinements } as any);

      const response = await request(app).get("/documents/doc-123/refinements");

      expect(response.status).toBe(200);
      expect(response.body.refinements).toHaveLength(2);
      expect(response.body.refinements[0].id).toBe("ref-2"); // Newest first
      expect(response.body.refinements[0].prompt).toBe("Add bullets");
      expect(response.body.refinements[1].id).toBe("ref-1");
    });

    it("should return empty array if no refinements exist", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "test-user-id" }],
      } as any);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app).get("/documents/doc-123/refinements");

      expect(response.status).toBe(200);
      expect(response.body.refinements).toEqual([]);
    });
  });

  describe("POST /documents/:id/restore", () => {
    it("should return 400 if refinementId is missing", async () => {
      const response = await request(app)
        .post("/documents/doc-123/restore")
        .set("Idempotency-Key", "test-restore-missing-id")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required field");
    });

    it("should return 404 if document not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post("/documents/doc-123/restore")
        .set("Idempotency-Key", "test-restore-404")
        .send({ refinementId: "ref-123" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Document not found");
    });

    it("should return 404 if refinement not found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "test-user-id" }],
      } as any);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any); // Refinement not found

      const response = await request(app)
        .post("/documents/doc-123/restore")
        .set("Idempotency-Key", "test-restore-404")
        .send({ refinementId: "ref-123" });

      expect(response.status).toBe(404);
      expect(response.body.error).toContain("Refinement not found");
    });

    it("should successfully restore a refinement", async () => {
      const restoredText = "Restored draft text";

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "doc-123", owner_id: "test-user-id" }],
      } as any);
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "ref-123", result: restoredText }],
      } as any);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any); // Update document

      const response = await request(app)
        .post("/documents/doc-123/restore")
        .set("Idempotency-Key", "test-restore-404")
        .send({ refinementId: "ref-123" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.draftText).toBe(restoredText);

      // Verify document was updated
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE documents"),
        expect.arrayContaining([restoredText, "doc-123"])
      );
    });
  });
});
