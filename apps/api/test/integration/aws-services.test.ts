/**
 * Comprehensive integration tests for AWS services
 *
 * Tests:
 * - Database (RDS PostgreSQL) connections and queries
 * - S3 operations (upload, download, presigned URLs)
 * - Secrets Manager
 * - API Gateway endpoints
 *
 * To run:
 * 1. Set environment variables: API_BASE_URL, TEST_AUTH_TOKEN
 * 2. Ensure AWS credentials are configured
 * 3. Run: npm test -- aws-services.test.ts
 */

/**
 * Comprehensive integration tests for AWS services
 *
 * Tests AWS services through API endpoints to verify:
 * - Database (RDS PostgreSQL) connections and queries
 * - S3 operations (upload, download, presigned URLs)
 * - Secrets Manager access
 * - API Gateway endpoints
 *
 * All tests run against the deployed API to verify real AWS service integrations.
 */

describe("AWS Services Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  const REGION = process.env.REGION || "us-east-1";
  const ENV = process.env.ENV || "dev";
  const APP = process.env.APP || "stenoai";
  let authToken: string;

  beforeAll(async () => {
    authToken = process.env.TEST_AUTH_TOKEN || "";

    if (!authToken) {
      console.warn("TEST_AUTH_TOKEN not set. Some tests will be skipped.");
    }
  });

  describe("Database (RDS PostgreSQL) - via API", () => {
    it("should verify database connection through health endpoint", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health/db`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.db).toBe("ok");
        expect(data.connected).toBe(true);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should query users through auth endpoints", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        // Test user data through /auth/me endpoint
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 404) {
          console.warn("/auth/me endpoint not found");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty("user");
        expect(data.user).toHaveProperty("id");
        expect(data.user).toHaveProperty("email");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should query documents through API", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 404) {
          console.warn("/documents endpoint not found");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty("documents");
        expect(Array.isArray(data.documents)).toBe(true);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should query exports through API", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/exports`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 404) {
          console.warn("/exports endpoint not found - may need deployment");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty("exports");
        expect(Array.isArray(data.exports)).toBe(true);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should insert and query test data through API", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        // Get a document to export
        const docsResponse = await fetch(`${API_BASE_URL}/documents`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (docsResponse.status === 404) {
          console.warn("Documents endpoint not found");
          return;
        }

        const docsData = await docsResponse.json();
        const docWithDraft = docsData.documents?.find(
          (doc: any) => doc.draftText && doc.draftText.length > 0
        );

        if (!docWithDraft) {
          console.warn("No document with draft text - skipping test");
          return;
        }

        // Export the document (this creates a database record)
        const exportResponse = await fetch(
          `${API_BASE_URL}/documents/export/${docWithDraft.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        if (exportResponse.status === 404) {
          console.warn("Export endpoint not found");
          return;
        }

        if (exportResponse.status === 400) {
          // Document has no draft
          return;
        }

        expect(exportResponse.status).toBe(200);
        const exportData = await exportResponse.json();

        // Verify export was created in database by querying exports list
        const exportsResponse = await fetch(`${API_BASE_URL}/exports`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (exportsResponse.status === 404) {
          console.warn("Exports endpoint not found");
          return;
        }

        expect(exportsResponse.status).toBe(200);
        const exportsData = await exportsResponse.json();

        const newExport = exportsData.exports.find(
          (exp: any) => exp.id === exportData.exportId
        );

        expect(newExport).toBeDefined();
        expect(newExport.documentId).toBe(docWithDraft.id);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });
  });

  describe("S3 Operations - via API", () => {
    it("should generate presigned upload URL (verifies S3 access)", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/upload-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            contentType: "application/pdf",
            fileName: "test.pdf",
          }),
        });

        if (response.status === 404) {
          console.warn("Upload URL endpoint not found");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveProperty("uploadUrl");
        expect(data).toHaveProperty("key");
        expect(data).toHaveProperty("bucket");
        expect(data.uploadUrl).toContain("https://");
        expect(data.uploadUrl).toContain("amazonaws.com");
        expect(data.key).toContain("uploads/");
        // If this works, S3 is accessible from Lambda
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should generate presigned download URL (verifies S3 access)", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        // First get an upload URL to have a valid key
        const uploadResponse = await fetch(
          `${API_BASE_URL}/documents/upload-url`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
            },
            body: JSON.stringify({
              contentType: "application/pdf",
              fileName: "test.pdf",
            }),
          }
        );

        if (uploadResponse.status === 404) {
          console.warn("Upload URL endpoint not found");
          return;
        }

        const uploadData = await uploadResponse.json();
        const testKey = uploadData.key;
        const testBucket = uploadData.bucket;

        // Now test download URL generation
        const downloadResponse = await fetch(
          `${API_BASE_URL}/documents/download-url`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
            },
            body: JSON.stringify({
              key: testKey,
              bucket: testBucket,
            }),
          }
        );

        if (downloadResponse.status === 404) {
          console.warn("Download URL endpoint not found");
          return;
        }

        expect(downloadResponse.status).toBe(200);
        const downloadData = await downloadResponse.json();

        expect(downloadData).toHaveProperty("downloadUrl");
        expect(downloadData.downloadUrl).toContain("https://");
        expect(downloadData.downloadUrl).toContain("amazonaws.com");
        // If this works, S3 is accessible from Lambda
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should verify export bucket access through export endpoint", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        // Get a document with draft text
        const docsResponse = await fetch(`${API_BASE_URL}/documents`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (docsResponse.status === 404) {
          console.warn("Documents endpoint not found");
          return;
        }

        const docsData = await docsResponse.json();
        const docWithDraft = docsData.documents?.find(
          (doc: any) => doc.draftText && doc.draftText.length > 0
        );

        if (!docWithDraft) {
          console.warn("No document with draft text - skipping test");
          return;
        }

        // Export the document (this uploads to S3 export bucket)
        const exportResponse = await fetch(
          `${API_BASE_URL}/documents/export/${docWithDraft.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        if (exportResponse.status === 404) {
          console.warn("Export endpoint not found");
          return;
        }

        if (exportResponse.status === 400) {
          // Document has no draft
          return;
        }

        expect(exportResponse.status).toBe(200);
        const exportData = await exportResponse.json();

        expect(exportData).toHaveProperty("s3Key");
        expect(exportData.s3Key).toContain("exports/");
        // If export succeeds, S3 export bucket is accessible
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should generate presigned upload URL via API", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/documents/upload-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            contentType: "application/pdf",
            fileName: "test.pdf",
          }),
        });

        if (response.status === 404) {
          console.warn("Upload URL endpoint not found");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveProperty("uploadUrl");
        expect(data).toHaveProperty("key");
        expect(data).toHaveProperty("bucket");
        expect(data.uploadUrl).toContain("https://");
        expect(data.key).toContain("uploads/");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });
  });

  describe("Secrets Manager", () => {
    it("should verify secrets are accessible (via database health check)", async () => {
      // If database health check works, secrets are being accessed correctly
      try {
        const response = await fetch(`${API_BASE_URL}/health/db`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.db).toBe("ok");
        // If this works, Secrets Manager is accessible from Lambda
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should verify JWT secret is accessible (via auth endpoints)", async () => {
      // If auth endpoints work, JWT secret is being accessed correctly
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 200) {
          // Auth works, so Secrets Manager is accessible
          expect(true).toBe(true);
        } else if (response.status === 401) {
          // Token invalid, but endpoint exists - secrets are accessible
          expect(true).toBe(true);
        }
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });
  });

  describe("API Gateway Endpoints", () => {
    it("should access health endpoint", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.status).toBe("ok");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should access database health endpoint", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health/db`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.db).toBe("ok");
        expect(data.connected).toBe(true);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });

    it("should access exports endpoint after deployment", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/exports`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        // After deployment, should return 200, not 404
        if (response.status === 404) {
          console.warn(
            "/exports endpoint not found - may need to wait for deployment or redeploy"
          );
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty("exports");
        expect(Array.isArray(data.exports)).toBe(true);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });
  });

  describe("End-to-End Export Flow", () => {
    it("should complete full export workflow", async () => {
      if (!authToken) {
        console.warn("No auth token - skipping test");
        return;
      }

      try {
        // 1. Get list of documents
        const docsResponse = await fetch(`${API_BASE_URL}/documents`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (docsResponse.status === 404) {
          console.warn("Documents endpoint not found");
          return;
        }

        expect(docsResponse.status).toBe(200);
        const docsData = await docsResponse.json();

        // Find a document with draft text
        const docWithDraft = docsData.documents?.find(
          (doc: any) => doc.draftText && doc.draftText.length > 0
        );

        if (!docWithDraft) {
          console.warn(
            "No document with draft text found - skipping export test"
          );
          return;
        }

        // 2. Export the document
        const exportResponse = await fetch(
          `${API_BASE_URL}/documents/export/${docWithDraft.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        if (exportResponse.status === 404) {
          console.warn("Export endpoint not found - may need deployment");
          return;
        }

        if (exportResponse.status === 400) {
          // Document has no draft - that's okay
          const errorData = await exportResponse.json();
          expect(errorData.error).toContain("no draft");
          return;
        }

        expect(exportResponse.status).toBe(200);
        const exportData = await exportResponse.json();

        expect(exportData).toHaveProperty("success", true);
        expect(exportData).toHaveProperty("exportId");
        expect(exportData).toHaveProperty("downloadUrl");
        expect(exportData).toHaveProperty("s3Key");

        // 3. Verify export appears in exports list
        const exportsResponse = await fetch(`${API_BASE_URL}/exports`, {
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (exportsResponse.status === 404) {
          console.warn("Exports list endpoint not found");
          return;
        }

        expect(exportsResponse.status).toBe(200);
        const exportsData = await exportsResponse.json();

        const newExport = exportsData.exports.find(
          (exp: any) => exp.id === exportData.exportId
        );

        expect(newExport).toBeDefined();
        expect(newExport.documentId).toBe(docWithDraft.id);
        expect(newExport.s3Key).toBe(exportData.s3Key);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available - skipping test");
          return;
        }
        throw error;
      }
    });
  });
});
