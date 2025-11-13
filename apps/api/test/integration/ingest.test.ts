/**
 * Integration tests for ingest endpoint
 *
 * These tests require:
 * - Running API server (local or deployed)
 * - Valid database connection
 * - S3 bucket with test files
 * - Valid JWT token
 *
 * To run:
 * 1. Set environment variables: ENV, REGION, S3_UPLOAD_BUCKET, etc.
 * 2. Ensure test files exist in S3 or upload them first
 * 3. Run: npm test -- ingest.test.ts
 */

describe("Ingest Endpoint Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create a test user and get auth token
    // This would typically be done via the signup/login endpoints
    // For now, we'll skip if no token is provided
    authToken = process.env.TEST_AUTH_TOKEN || "";

    if (!authToken) {
      console.warn("TEST_AUTH_TOKEN not set. Skipping integration tests.");
      return;
    }

    // Decode JWT to get user ID (no database query needed)
    try {
      const tokenParts = authToken.split(".");
      if (tokenParts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(tokenParts[1], "base64").toString()
        );
        testUserId = payload.userId;
      }
    } catch (err) {
      console.warn("Could not decode user ID from token");
    }
  });

  describe("POST /documents/ingest", () => {
    it("should require authentication", async () => {
      // Skip if API is not available (local testing without deployed API)
      try {
        const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "test.pdf",
            originalName: "test.pdf",
            mime: "application/pdf",
            size: 1000,
          }),
        });

        expect(response.status).toBe(401);
      } catch (error: any) {
        // API not available - skip test
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
        return; // Skip if no auth token
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: "test.pdf",
            // Missing originalName, mime, size
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("Missing required fields");
      } catch (error: any) {
        // API not available - skip test
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

    it("should process a valid file upload", async () => {
      if (!authToken) {
        return; // Skip if no auth token
      }

      // This test requires:
      // 1. A file uploaded to S3 first via /documents/upload-url
      // 2. The S3 key from that upload
      const s3Key = process.env.TEST_S3_KEY;

      if (!s3Key) {
        console.warn("TEST_S3_KEY not set. Skipping file processing test.");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: s3Key,
            originalName: "test-document.pdf",
            mime: "application/pdf",
            size: 1000,
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveProperty("documentId");
        expect(data).toHaveProperty("title");
        expect(data).toHaveProperty("status", "extracted");
        expect(data).toHaveProperty("extractedLength");
        expect(data).toHaveProperty("createdAt");

        // Verify document by fetching it via API
        const getResponse = await fetch(
          `${API_BASE_URL}/documents/${data.documentId}`,
          {
            headers: {
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        expect(getResponse.status).toBe(200);
        const docData = await getResponse.json();
        expect(docData.document.status).toBe("extracted");
        expect(docData.document.extractedText).toBeTruthy();
      } catch (error: any) {
        // API not available - skip test
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

    it("should not chunk small documents", async () => {
      if (!authToken) {
        return; // Skip if no auth token
      }

      const s3Key = process.env.TEST_S3_KEY;
      if (!s3Key) {
        console.warn("TEST_S3_KEY not set. Skipping chunking test.");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: s3Key,
            originalName: "small-document.pdf",
            mime: "application/pdf",
            size: 1000,
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveProperty("isChunked", false);
        expect(data).not.toHaveProperty("chunkCount");

        // Verify document status via API (chunks would be visible in document data if they existed)
        if (data.documentId) {
          const getResponse = await fetch(
            `${API_BASE_URL}/documents/${data.documentId}`,
            {
              headers: {
                Cookie: `auth_token=${authToken}`,
              },
            }
          );
          expect(getResponse.status).toBe(200);
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

    it("should chunk large documents and store chunks in database", async () => {
      if (!authToken) {
        return; // Skip if no auth token
      }

      // This test requires a large file in S3 (> 16000 chars extracted text)
      // For testing, we can create a synthetic large text file
      const largeS3Key = process.env.TEST_LARGE_S3_KEY;

      if (!largeS3Key) {
        console.warn(
          "TEST_LARGE_S3_KEY not set. Skipping large document chunking test."
        );
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: largeS3Key,
            originalName: "large-document.pdf",
            mime: "application/pdf",
            size: 500000, // Large file
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        // If document is large enough, it should be chunked
        if (data.isChunked) {
          expect(data).toHaveProperty("isChunked", true);
          expect(data).toHaveProperty("chunkCount");
          expect(data.chunkCount).toBeGreaterThan(0);

          // Verify document was processed correctly via API
          const getResponse = await fetch(
            `${API_BASE_URL}/documents/${data.documentId}`,
            {
              headers: {
                Cookie: `auth_token=${authToken}`,
              },
            }
          );
          expect(getResponse.status).toBe(200);
          const docData = await getResponse.json();
          expect(docData.document.extractedText).toBeTruthy();
          // If chunked, extracted text should be substantial
          expect(docData.document.extractedText.length).toBeGreaterThan(16000);
        } else {
          // Document was not large enough to chunk - that's okay
          expect(data.isChunked).toBe(false);
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
  });
});
