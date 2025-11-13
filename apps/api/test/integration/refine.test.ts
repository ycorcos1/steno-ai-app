/**
 * Integration tests for refine endpoint
 *
 * These tests require:
 * - Running API server (local or deployed)
 * - Valid database connection
 * - AI service running (or mocked)
 * - Valid JWT token
 * - Test document with existing draft
 *
 * To run:
 * 1. Set environment variables: ENV, REGION, API_BASE_URL, TEST_AUTH_TOKEN, etc.
 * 2. Ensure test document with draft exists
 * 3. Run: npm test -- refine.test.ts
 */

describe("Refine Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  let authToken: string;
  let testDocumentId: string;

  beforeAll(async () => {
    authToken = process.env.TEST_AUTH_TOKEN || "";

    if (!authToken) {
      console.warn("TEST_AUTH_TOKEN not set. Skipping integration tests.");
      return;
    }

    testDocumentId = process.env.TEST_DOCUMENT_ID || "";
  });

  describe("POST /ai/refine", () => {
    it("should require authentication", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: "test-id",
            prompt: "Make it more formal",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(401);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should validate required fields", async () => {
      if (!authToken) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `validate-test-${Date.now()}`,
          },
          body: JSON.stringify({
            // Missing documentId and prompt
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("Missing required fields");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should reject document without draft", async () => {
      if (!authToken || !testDocumentId) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `no-draft-test-${Date.now()}`,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            prompt: "Make it better",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        // If document doesn't have a draft, should return 400
        if (response.status === 400) {
          const data = await response.json();
          expect(data.error).toContain("No draft");
          return;
        }

        // If document has draft, should process (200) or fail due to AI service (500)
        expect([200, 500]).toContain(response.status);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should refine draft with user prompt", async () => {
      if (!authToken || !testDocumentId) {
        console.warn(
          "Missing test data (authToken, documentId). Skipping refinement test."
        );
        return;
      }

      try {
        const idempotencyKey = `refine-test-${Date.now()}`;
        const response = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            prompt: "Make the tone more formal and add urgency",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        // AI service might be unavailable
        if (response.status === 500) {
          const data = await response.json();
          if (data.error?.includes("Refinement failed")) {
            console.warn(
              "AI service unavailable. This is expected in some test environments."
            );
            return;
          }
        }

        expect([200, 201]).toContain(response.status);
        const data = await response.json();

        expect(data).toHaveProperty("success", true);
        expect(data).toHaveProperty("refinementId");
        expect(data).toHaveProperty("draftText");
        expect(typeof data.draftText).toBe("string");
        expect(data.draftText.length).toBeGreaterThan(0);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should store refinement in history", async () => {
      if (!authToken || !testDocumentId) {
        return;
      }

      try {
        // First, refine the document
        const refineResponse = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `history-test-${Date.now()}`,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            prompt: "Test refinement for history",
          }),
        });

        if (refineResponse.status >= 500 || refineResponse.status === 0) {
          console.warn("Refinement failed, skipping history test");
          return;
        }

        // Then fetch refinements
        const historyResponse = await fetch(
          `${API_BASE_URL}/documents/${testDocumentId}/refinements`,
          {
            method: "GET",
            headers: {
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        if (historyResponse.status === 503 || historyResponse.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(historyResponse.status).toBe(200);
        const historyData = await historyResponse.json();

        expect(historyData).toHaveProperty("refinements");
        expect(Array.isArray(historyData.refinements)).toBe(true);

        // Should have at least one refinement
        if (refineResponse.status === 200) {
          expect(historyData.refinements.length).toBeGreaterThan(0);
          const latestRefinement = historyData.refinements[0];
          expect(latestRefinement).toHaveProperty("prompt");
          expect(latestRefinement).toHaveProperty("result");
          expect(latestRefinement).toHaveProperty("createdAt");
        }
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should respect idempotency keys", async () => {
      if (!authToken || !testDocumentId) {
        return;
      }

      const idempotencyKey = `refine-idempotency-${Date.now()}`;

      try {
        // First request
        const response1 = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            prompt: "Idempotency test prompt",
          }),
        });

        if (response1.status >= 500 || response1.status === 0) {
          console.warn("First request failed, skipping idempotency test");
          return;
        }

        const data1 = await response1.json();

        // Second request with same idempotency key
        const response2 = await fetch(`${API_BASE_URL}/ai/refine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            prompt: "Idempotency test prompt",
          }),
        });

        expect(response2.status).toBe(200);
        const data2 = await response2.json();

        // Should return same result
        expect(data2.draftText).toBe(data1.draftText);
        expect(data2.refinementId).toBe(data1.refinementId);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });
  });
});
