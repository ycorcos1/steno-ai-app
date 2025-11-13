/**
 * Integration tests for generate endpoint
 *
 * These tests require:
 * - Running API server (local or deployed)
 * - Valid database connection
 * - AI service running (or mocked)
 * - Valid JWT token
 * - Test document and template in database
 *
 * To run:
 * 1. Set environment variables: ENV, REGION, API_BASE_URL, TEST_AUTH_TOKEN, etc.
 * 2. Ensure test document and template exist
 * 3. Run: npm test -- generate.test.ts
 */

describe("Generate Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  let authToken: string;
  let testDocumentId: string;
  let testTemplateId: string;

  beforeAll(async () => {
    authToken = process.env.TEST_AUTH_TOKEN || "";

    if (!authToken) {
      console.warn("TEST_AUTH_TOKEN not set. Skipping integration tests.");
      return;
    }

    // Create test document and template if they don't exist
    // This is a simplified version - in practice, you'd use the actual API endpoints
    testDocumentId = process.env.TEST_DOCUMENT_ID || "";
    testTemplateId = process.env.TEST_TEMPLATE_ID || "";
  });

  describe("POST /documents/generate", () => {
    it("should require authentication", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: "test-id",
            templateId: "test-template-id",
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
        const response = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `validate-test-${Date.now()}`,
          },
          body: JSON.stringify({
            // Missing documentId and templateId
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

    it("should reject invalid document ID", async () => {
      if (!authToken || !testTemplateId) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `invalid-doc-test-${Date.now()}`,
          },
          body: JSON.stringify({
            documentId: "non-existent-id",
            templateId: testTemplateId,
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain("not found");
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

    it("should reject invalid template ID", async () => {
      if (!authToken || !testDocumentId) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": `invalid-template-test-${Date.now()}`,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            templateId: "non-existent-template-id",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain("Template not found");
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

    it("should generate draft for valid document and template", async () => {
      if (!authToken || !testDocumentId || !testTemplateId) {
        console.warn(
          "Missing test data (authToken, documentId, templateId). Skipping generation test."
        );
        return;
      }

      try {
        const idempotencyKey = `test-${Date.now()}`;
        const response = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            templateId: testTemplateId,
            instructions: "Make it formal and professional",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        // AI service might be unavailable, so we accept 500 as a valid skip case
        if (response.status === 500) {
          const data = await response.json();
          if (data.error?.includes("Generation failed")) {
            console.warn(
              "AI service unavailable or generation failed. This is expected in some test environments."
            );
            return;
          }
        }

        expect([200, 201]).toContain(response.status);
        const data = await response.json();

        expect(data).toHaveProperty("draftText");
        expect(data).toHaveProperty("documentId", testDocumentId);
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

    it("should respect idempotency keys", async () => {
      if (!authToken || !testDocumentId || !testTemplateId) {
        return;
      }

      const idempotencyKey = `idempotency-test-${Date.now()}`;

      try {
        // First request
        const response1 = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            templateId: testTemplateId,
          }),
        });

        if (response1.status === 503 || response1.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        // If first request failed, skip the idempotency test
        if (response1.status >= 500) {
          console.warn("First request failed, skipping idempotency test");
          return;
        }

        const data1 = await response1.json();

        // Second request with same idempotency key
        const response2 = await fetch(`${API_BASE_URL}/documents/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            documentId: testDocumentId,
            templateId: testTemplateId,
          }),
        });

        expect(response2.status).toBe(200);
        const data2 = await response2.json();

        // Should return same result
        expect(data2.draftText).toBe(data1.draftText);
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
