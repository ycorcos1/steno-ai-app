import express, { Request, Response } from "express";
import axios from "axios";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";
import { composePrompt } from "../lib/composePrompt";
import { mergeChunks, ChunkResult } from "../lib/merge";
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
 * POST /documents/generate
 * Generate AI draft based on document and template
 * Requires authentication via JWT cookie
 */
router.post(
  "/generate",
  authenticateToken,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { documentId, templateId, instructions } = req.body;
      const userId = req.user?.userId;

      // Validate required fields
      if (!documentId || !templateId) {
        return res.status(400).json({
          error: "Missing required fields: documentId, templateId",
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
        `SELECT id, owner_id, extracted_text, status
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
        [documentId, userId]
      );

      if (docResult.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const document = docResult.rows[0];
      const extractedText = document.extracted_text || "";

      // Fetch template and verify access (owner or global)
      const templateResult = await query(
        `SELECT id, title, content, is_global, owner_id
         FROM templates
         WHERE id = $1 AND (owner_id = $2 OR is_global = true)`,
        [templateId, userId]
      );

      if (templateResult.rows.length === 0) {
        return res.status(404).json({ error: "Template not found" });
      }

      const template = templateResult.rows[0];
      const templateContent = template.content || "";

      // Check if document has chunks
      const chunksResult = await query(
        `SELECT idx, start, "end", summary
         FROM doc_chunks
         WHERE document_id = $1
         ORDER BY idx ASC`,
        [documentId]
      );

      const hasChunks = chunksResult.rows.length > 0;
      let draftText: string;

      if (hasChunks) {
        // Process chunked document
        const chunks = chunksResult.rows;
        const chunkResults: ChunkResult[] = [];

        // Process each chunk individually
        for (const chunk of chunks) {
          // Fetch chunk text from original extracted text using start/end positions
          const chunkText = extractedText.substring(
            chunk.start as number,
            chunk.end as number
          );

          // Compose prompt for this chunk
          const chunkPrompt = composePrompt(
            chunkText,
            templateContent,
            instructions
          );

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
                body: JSON.stringify({ prompt: chunkPrompt }),
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

          chunkResults.push({
            idx: chunk.idx as number,
            text: aiResponse.data.text || "",
          });
        }

        // Merge chunk results
        draftText = mergeChunks(chunkResults);
      } else {
        // Process non-chunked document
        const prompt = composePrompt(
          extractedText,
          templateContent,
          instructions
        );

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
              body: JSON.stringify({ prompt }),
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

        draftText = aiResponse.data.text || "";
      }

      // Save draft to database
      await query(
        `UPDATE documents
         SET draft_text = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [draftText, "draft_generated", documentId]
      );

      // Return response
      res.json({
        draftText,
        documentId,
        ...(hasChunks && { chunkCount: chunksResult.rows.length }),
      });
    } catch (error: any) {
      console.error("Generation error:", error);
      res.status(500).json({
        error: "Generation failed",
        message: error.message || "Unknown error",
      });
    }
  }
);

export default router;
