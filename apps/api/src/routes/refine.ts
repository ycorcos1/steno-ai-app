import express, { Request, Response } from "express";
import axios from "axios";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { retry } from "../lib/retry";
import {
  LambdaClient,
  InvokeCommand,
  InvokeCommandInput,
} from "@aws-sdk/client-lambda";

const router = express.Router();
router.use(express.json());

/**
 * POST /ai/refine
 * Refine an existing draft using AI based on user instructions
 * Requires authentication via JWT cookie
 */
router.post(
  "/refine",
  authenticateToken,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { documentId, prompt } = req.body;
      const userId = req.user?.userId;

      // Validate required fields
      if (!documentId || !prompt) {
        return res.status(400).json({
          error: "Missing required fields: documentId, prompt",
        });
      }

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Get AI Lambda function name from environment
      const aiFunctionName =
        process.env.AI_FUNCTION_NAME ||
        `${process.env.APP || "stenoai"}-${process.env.ENV || "dev"}-ai`;

      // Use Lambda client for direct invocation (works within VPC)
      const lambdaClient = new LambdaClient({
        region: process.env.REGION || "us-east-1",
        requestHandler: {
          requestTimeout: 110000, // 110s timeout (less than Lambda's 120s)
        },
      });

      // Fetch document and verify ownership
      const docResult = await query(
        `SELECT id, owner_id, draft_text, status
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
        [documentId, userId]
      );

      if (docResult.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const document = docResult.rows[0];
      const currentDraft = document.draft_text;

      // Check if draft exists
      if (!currentDraft || currentDraft.trim().length === 0) {
        return res.status(400).json({
          error: "No draft to refine. Please generate a draft first.",
        });
      }

      // Compose refinement prompt
      const refinementPrompt = `You are a legal drafting assistant. Refine the following draft according to the user's request. Maintain professional tone and legal formatting.

**Current Draft:**
${currentDraft}

**User's Refinement Request:**
${prompt}

Generate the refined version of the draft that incorporates the user's requested changes while maintaining coherence and professional quality.`;

      // Call AI Lambda directly with retry logic
      const aiResponse = await retry(
        async () => {
          // Format event for Mangum (API Gateway HTTP API v2 format)
          const event = {
            version: "2.0",
            routeKey: "POST /generate",
            rawPath: "/generate",
            rawQueryString: "",
            headers: {
              "content-type": "application/json",
              host: "localhost",
              "user-agent": "lambda-invoke",
            },
            requestContext: {
              http: {
                method: "POST",
                path: "/generate",
                sourceIp: "127.0.0.1",
                userAgent: "lambda-invoke",
              },
              requestId: `req-${Date.now()}`,
              domainName: "lambda.internal",
              stage: "prod",
            },
            body: JSON.stringify({ prompt: refinementPrompt }),
            isBase64Encoded: false,
          };

          const invokeParams: InvokeCommandInput = {
            FunctionName: aiFunctionName,
            Payload: JSON.stringify(event),
            InvocationType: "RequestResponse",
          };

          console.log(`Invoking AI Lambda: ${aiFunctionName}`);
          const command = new InvokeCommand(invokeParams);
          const startTime = Date.now();
          const response = await lambdaClient.send(command);
          const duration = Date.now() - startTime;
          console.log(`AI Lambda invocation completed in ${duration}ms`);

          if (response.FunctionError) {
            const errorPayload = response.Payload
              ? JSON.parse(new TextDecoder().decode(response.Payload))
              : null;
            throw new Error(
              `Lambda invocation failed: ${
                response.FunctionError
              } - ${JSON.stringify(errorPayload)}`
            );
          }

          const payload = JSON.parse(
            new TextDecoder().decode(response.Payload)
          );

          // Handle Mangum response format (API Gateway HTTP API v2)
          if (payload.statusCode === 200 && payload.body) {
            return { data: JSON.parse(payload.body) };
          } else if (payload.statusCode) {
            throw new Error(
              `AI Lambda returned error: ${payload.statusCode} - ${
                payload.body || JSON.stringify(payload)
              }`
            );
          }
          // Fallback: try to parse as direct response
          return { data: payload };
        },
        { maxAttempts: 5, initialDelayMs: 100 }
      );

      const refinedText = aiResponse.data.text || "";

      // Store refinement in database
      const refinementResult = await query(
        `INSERT INTO refinements (document_id, prompt, result)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [documentId, prompt, refinedText]
      );

      const refinementId = refinementResult.rows[0].id;

      // Update document with refined draft
      await query(
        `UPDATE documents
         SET draft_text = $1, updated_at = NOW()
         WHERE id = $2`,
        [refinedText, documentId]
      );

      // Return response
      res.json({
        success: true,
        refinementId,
        draftText: refinedText,
      });
    } catch (error: any) {
      console.error("Refinement error:", error);
      res.status(500).json({
        error: "Refinement failed",
        message: error.message || "Unknown error",
      });
    }
  }
);

/**
 * GET /documents/:id/refinements
 * Get all refinements for a document
 * Requires authentication via JWT cookie
 */
router.get(
  "/:id/refinements",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id: documentId } = req.params;
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Verify document access (owner or collaborator)
      const accessCheckResult = await query(
        `SELECT id, owner_id
         FROM documents
         WHERE id = $1`,
        [documentId]
      );

      if (accessCheckResult.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const accessDocument = accessCheckResult.rows[0];

      // Check if user is owner or collaborator
      if (accessDocument.owner_id !== userId) {
        // Check if user is a collaborator
        const collabResult = await query(
          `SELECT id
           FROM document_collaborators
           WHERE document_id = $1 AND user_id = $2`,
          [documentId, userId]
        );

        if (collabResult.rows.length === 0) {
          return res.status(403).json({
            error:
              "Access denied. You are not authorized to view this document.",
          });
        }
      }

      // Fetch document to get original draft
      const docDraftResult = await query(
        `SELECT draft_text, status, updated_at
         FROM documents
         WHERE id = $1`,
        [documentId]
      );

      const docDraft = docDraftResult.rows[0];
      const originalDraft = docDraft?.draft_text;
      const originalDraftDate = docDraft?.updated_at;

      // Fetch refinements
      const refinementsResult = await query(
        `SELECT id, prompt, result, created_at
         FROM refinements
         WHERE document_id = $1
         ORDER BY created_at DESC`,
        [documentId]
      );

      const refinements = refinementsResult.rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        result: row.result,
        createdAt: row.created_at.toISOString(),
      }));

      // Include original draft if it exists and document has been generated
      const history: Array<{
        id: string;
        prompt: string | null;
        result: string;
        createdAt: string;
        isOriginal: boolean;
      }> = [];

      // Add refinements first (newest to oldest)
      refinements.forEach((refinement) => {
        history.push({
          ...refinement,
          isOriginal: false,
        });
      });

      // Add original draft at the end (oldest) if it exists
      if (
        originalDraft &&
        originalDraft.trim().length > 0 &&
        docDraft?.status === "draft_generated"
      ) {
        history.push({
          id: "original",
          prompt: null,
          result: originalDraft,
          createdAt: originalDraftDate.toISOString(),
          isOriginal: true,
        });
      }

      // Sort by date descending (newest first) for display
      history.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      res.json({ refinements: history });
    } catch (error: any) {
      console.error("Error fetching refinements:", error);
      res.status(500).json({
        error: "Failed to fetch refinements",
        message: error.message || "Unknown error",
      });
    }
  }
);

/**
 * POST /documents/:id/restore
 * Restore a document draft to a previous refinement version
 * Requires authentication via JWT cookie
 */
router.post(
  "/:id/restore",
  authenticateToken,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id: documentId } = req.params;
      const { refinementId } = req.body;
      const userId = req.user?.userId;

      // Validate required fields
      if (!refinementId) {
        return res.status(400).json({
          error: "Missing required field: refinementId",
        });
      }

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Verify document ownership
      const docResult = await query(
        `SELECT id, owner_id
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
        [documentId, userId]
      );

      if (docResult.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Handle restoring to original draft
      if (refinementId === "original") {
        const originalDocResult = await query(
          `SELECT draft_text, updated_at FROM documents WHERE id = $1 AND owner_id = $2`,
          [documentId, userId]
        );

        if (originalDocResult.rows.length === 0) {
          return res.status(404).json({ error: "Document not found" });
        }

        const originalDraftText = originalDocResult.rows[0].draft_text;
        const originalUpdatedAt = originalDocResult.rows[0].updated_at;

        if (!originalDraftText || originalDraftText.trim().length === 0) {
          return res.status(400).json({
            error: "Original draft not found or is empty",
          });
        }

        // Delete all refinements (they all came after the original)
        await query(`DELETE FROM refinements WHERE document_id = $1`, [
          documentId,
        ]);

        // Update document with original draft
        await query(
          `UPDATE documents
               SET draft_text = $1, updated_at = NOW()
               WHERE id = $2`,
          [originalDraftText, documentId]
        );

        res.json({
          success: true,
          draftText: originalDraftText,
        });
        return;
      }

      // Fetch refinement and verify it belongs to this document
      const refinementResult = await query(
        `SELECT id, result, created_at
         FROM refinements
         WHERE id = $1 AND document_id = $2`,
        [refinementId, documentId]
      );

      if (refinementResult.rows.length === 0) {
        return res.status(404).json({
          error: "Refinement not found or does not belong to this document",
        });
      }

      const refinement = refinementResult.rows[0];
      const restoredText = refinement.result;
      const restoredCreatedAt = refinement.created_at;

      // Delete all refinements created AFTER this one (newer versions)
      await query(
        `DELETE FROM refinements
         WHERE document_id = $1 AND created_at > $2`,
        [documentId, restoredCreatedAt]
      );

      // Update document with restored draft
      await query(
        `UPDATE documents
         SET draft_text = $1, updated_at = NOW()
         WHERE id = $2`,
        [restoredText, documentId]
      );

      res.json({
        success: true,
        draftText: restoredText,
      });
    } catch (error: any) {
      console.error("Restore error:", error);
      res.status(500).json({
        error: "Restore failed",
        message: error.message || "Unknown error",
      });
    }
  }
);

export default router;
