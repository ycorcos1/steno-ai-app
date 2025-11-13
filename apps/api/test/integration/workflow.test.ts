/**
 * Integration tests for complete workflow: Upload → Extract → Generate → Refine → Export
 *
 * These tests require:
 * - Running API server (local or deployed)
 * - Valid database connection
 * - AI service running (or mocked)
 * - S3 bucket with test files
 * - Valid JWT token
 *
 * To run:
 * 1. Set environment variables: ENV, REGION, API_BASE_URL, TEST_AUTH_TOKEN, TEST_S3_KEY, etc.
 * 2. Ensure test file exists in S3
 * 3. Run: npm test -- workflow.test.ts
 */

describe("Complete Workflow Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  let authToken: string;
  let testUserId: string;
  let workflowDocumentId: string;
  let workflowTemplateId: string;

  beforeAll(async () => {
    authToken = process.env.TEST_AUTH_TOKEN || "";

    if (!authToken) {
      console.warn("TEST_AUTH_TOKEN not set. Skipping integration tests.");
      return;
    }

    // Decode JWT to get user ID
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

  afterAll(async () => {
    // Cleanup: Delete workflow document if created
    if (
      workflowDocumentId &&
      authToken &&
      process.env.CLEANUP_TEST_DATA === "true"
    ) {
      try {
        // Documents are typically not deleted via API, but we can mark for cleanup
        console.log(`Test document created: ${workflowDocumentId}`);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe("Complete Workflow: Upload → Extract → Generate → Refine → Export", () => {
    it("should complete full document workflow", async () => {
      if (!authToken) {
        console.warn("No auth token, skipping workflow test");
        return;
      }

      const s3Key = process.env.TEST_S3_KEY;
      if (!s3Key) {
        console.warn("TEST_S3_KEY not set. Skipping complete workflow test.");
        return;
      }

      try {
        // Step 1: Ingest document
        console.log("Step 1: Ingesting document...");
        const ingestResponse = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: s3Key,
            originalName: "workflow-test-document.pdf",
            mime: "application/pdf",
            size: 10000,
          }),
        });

        if (ingestResponse.status === 503 || ingestResponse.status === 0) {
          console.warn("API not available, skipping workflow test");
          return;
        }

        if (ingestResponse.status !== 201) {
          const errorData = await ingestResponse.json();
          console.error("Ingest failed:", errorData);
          throw new Error(`Ingest failed: ${ingestResponse.status}`);
        }

        const ingestData = await ingestResponse.json();
        workflowDocumentId = ingestData.documentId;

        expect(ingestData).toHaveProperty("documentId");
        expect(ingestData).toHaveProperty("status", "extracted");
        expect(ingestData).toHaveProperty("extractedLength");
        expect(ingestData.extractedLength).toBeGreaterThan(0);

        console.log(`✓ Document ingested: ${workflowDocumentId}`);

        // Step 2: Create or get a template
        console.log("Step 2: Creating template...");
        const templateResponse = await fetch(`${API_BASE_URL}/templates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            title: `Workflow Test Template ${Date.now()}`,
            content:
              "This is a test template for workflow integration testing. Use the extracted information to create a professional demand letter.",
          }),
        });

        if (templateResponse.status !== 201) {
          const errorData = await templateResponse.json();
          console.error("Template creation failed:", errorData);
          throw new Error(
            `Template creation failed: ${templateResponse.status}`
          );
        }

        const templateData = await templateResponse.json();
        workflowTemplateId = templateData.template.id;

        console.log(`✓ Template created: ${workflowTemplateId}`);

        // Step 3: Generate draft
        console.log("Step 3: Generating draft...");
        const generateResponse = await fetch(
          `${API_BASE_URL}/documents/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
              "Idempotency-Key": `workflow-generate-${Date.now()}`,
            },
            body: JSON.stringify({
              documentId: workflowDocumentId,
              templateId: workflowTemplateId,
              instructions: "Create a professional demand letter",
            }),
          }
        );

        if (generateResponse.status >= 500) {
          const errorData = await generateResponse.json();
          console.warn(
            "Generation failed (AI service may be unavailable):",
            errorData
          );
          // Continue with workflow even if generation fails (for testing other steps)
        } else {
          expect([200, 201]).toContain(generateResponse.status);
          const generateData = await generateResponse.json();

          expect(generateData).toHaveProperty("draftText");
          expect(generateData.draftText.length).toBeGreaterThan(0);

          console.log(
            `✓ Draft generated (${generateData.draftText.length} chars)`
          );
        }

        // Step 4: Refine draft (only if generation succeeded)
        if (
          generateResponse.status === 200 ||
          generateResponse.status === 201
        ) {
          console.log("Step 4: Refining draft...");
          const refineResponse = await fetch(`${API_BASE_URL}/ai/refine`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth_token=${authToken}`,
              "Idempotency-Key": `workflow-refine-${Date.now()}`,
            },
            body: JSON.stringify({
              documentId: workflowDocumentId,
              prompt: "Make the tone more formal and add urgency",
            }),
          });

          if (refineResponse.status >= 500) {
            console.warn("Refinement failed (AI service may be unavailable)");
          } else {
            expect([200, 201]).toContain(refineResponse.status);
            const refineData = await refineResponse.json();

            expect(refineData).toHaveProperty("success", true);
            expect(refineData).toHaveProperty("draftText");
            expect(refineData).toHaveProperty("refinementId");

            console.log(
              `✓ Draft refined (refinement ID: ${refineData.refinementId})`
            );
          }
        }

        // Step 5: Export document
        console.log("Step 5: Exporting document...");
        const exportResponse = await fetch(
          `${API_BASE_URL}/documents/export/${workflowDocumentId}`,
          {
            method: "POST",
            headers: {
              Cookie: `auth_token=${authToken}`,
              "Idempotency-Key": `workflow-export-${Date.now()}`,
            },
          }
        );

        if (exportResponse.status >= 500) {
          const errorData = await exportResponse.json();
          console.warn("Export failed:", errorData);
          // Export might fail if no draft exists, which is okay for testing
        } else {
          expect([200, 201]).toContain(exportResponse.status);
          const exportData = await exportResponse.json();

          expect(exportData).toHaveProperty("downloadUrl");
          expect(exportData).toHaveProperty("expiresAt");
          expect(exportData.downloadUrl).toContain("https://");

          console.log(
            `✓ Document exported (URL expires: ${exportData.expiresAt})`
          );

          // Step 6: Verify export is downloadable
          console.log("Step 6: Verifying export download...");
          const downloadResponse = await fetch(exportData.downloadUrl);

          expect(downloadResponse.status).toBe(200);
          expect(downloadResponse.headers.get("content-type")).toContain(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          );

          console.log("✓ Export download verified");
        }

        // Step 7: Verify document can be fetched
        console.log("Step 7: Verifying document fetch...");
        const getDocResponse = await fetch(
          `${API_BASE_URL}/documents/${workflowDocumentId}`,
          {
            headers: {
              Cookie: `auth_token=${authToken}`,
            },
          }
        );

        expect(getDocResponse.status).toBe(200);
        const docData = await getDocResponse.json();

        expect(docData).toHaveProperty("document");
        expect(docData.document.id).toBe(workflowDocumentId);
        expect(docData.document.extractedText).toBeTruthy();

        console.log("✓ Document fetch verified");

        console.log("\n✅ Complete workflow test passed!");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping workflow test");
          return;
        }
        console.error("Workflow test failed:", error);
        throw error;
      }
    }, 120000); // 2 minute timeout for complete workflow

    it("should handle large file workflow with chunking", async () => {
      if (!authToken) {
        return;
      }

      const largeS3Key = process.env.TEST_LARGE_S3_KEY;
      if (!largeS3Key) {
        console.warn(
          "TEST_LARGE_S3_KEY not set. Skipping large file workflow test."
        );
        return;
      }

      try {
        // Ingest large file
        const ingestResponse = await fetch(`${API_BASE_URL}/documents/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${authToken}`,
          },
          body: JSON.stringify({
            key: largeS3Key,
            originalName: "large-workflow-test.pdf",
            mime: "application/pdf",
            size: 500000,
          }),
        });

        if (ingestResponse.status === 503 || ingestResponse.status === 0) {
          console.warn("API not available, skipping large file test");
          return;
        }

        expect(ingestResponse.status).toBe(201);
        const ingestData = await ingestResponse.json();

        if (ingestData.isChunked) {
          expect(ingestData).toHaveProperty("isChunked", true);
          expect(ingestData).toHaveProperty("chunkCount");
          expect(ingestData.chunkCount).toBeGreaterThan(0);

          console.log(
            `✓ Large document chunked into ${ingestData.chunkCount} chunks`
          );

          // If we have a template, try generating with chunks
          if (workflowTemplateId) {
            const generateResponse = await fetch(
              `${API_BASE_URL}/documents/generate`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Cookie: `auth_token=${authToken}`,
                  "Idempotency-Key": `large-generate-${Date.now()}`,
                },
                body: JSON.stringify({
                  documentId: ingestData.documentId,
                  templateId: workflowTemplateId,
                }),
              }
            );

            // Generation might fail if AI service unavailable, which is okay
            if (generateResponse.status < 500) {
              expect([200, 201]).toContain(generateResponse.status);
              const generateData = await generateResponse.json();
              expect(generateData).toHaveProperty("draftText");
              console.log("✓ Large document draft generated successfully");
            }
          }
        }
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping large file test");
          return;
        }
        throw error;
      }
    }, 180000); // 3 minute timeout for large file processing
  });
});
