import express, { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Document, Paragraph, TextRun, Packer } from "docx";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { retry } from "../lib/retry";
import {
  LambdaClient,
  InvokeCommand,
  InvokeCommandInput,
} from "@aws-sdk/client-lambda";

const router = express.Router();
router.use(express.json());

const s3Client = new S3Client({
  region: process.env.REGION || "us-east-1",
});

/**
 * POST /documents/export/:id
 * Generate .docx from draft_text and upload to S3
 */
router.post(
  "/export/:id",
  authenticateToken,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const documentId = req.params.id;
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Verify document exists and user owns it
      const docResult = await query(
        `SELECT id, owner_id, title, draft_text FROM documents WHERE id = $1`,
        [documentId]
      );

      if (docResult.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const doc = docResult.rows[0];
      if (doc.owner_id !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!doc.draft_text) {
        return res.status(400).json({
          error: "Document has no draft to export. Generate a draft first.",
        });
      }

      // Generate appropriate filename using AI
      const aiFunctionName =
        process.env.AI_FUNCTION_NAME ||
        `${process.env.APP || "stenoai"}-${process.env.ENV || "dev"}-ai`;

      const lambdaClient = new LambdaClient({
        region: process.env.REGION || "us-east-1",
        requestHandler: {
          requestTimeout: 30000, // 30s timeout for filename generation
        },
      });

      // Generate filename based on draft content
      let fileName = `${doc.title || "export"}.docx`;
      try {
        const filenamePrompt = `Based on the following legal document draft, generate a concise, professional filename (without extension) that describes the document. The filename should be suitable for a Word document export. Use underscores instead of spaces, and keep it under 60 characters. Only return the filename, nothing else.

**Draft Content (first 500 characters):**
${doc.draft_text.substring(0, 500)}...

Generate only the filename (no extension, no quotes, no explanation):`;

        const aiResponse = await retry(
          async () => {
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
              body: JSON.stringify({ prompt: filenamePrompt }),
              isBase64Encoded: false,
            };

            const invokeParams: InvokeCommandInput = {
              FunctionName: aiFunctionName,
              Payload: JSON.stringify(event),
              InvocationType: "RequestResponse",
            };

            const command = new InvokeCommand(invokeParams);
            const response = await lambdaClient.send(command);

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

            if (payload.statusCode === 200 && payload.body) {
              return { data: JSON.parse(payload.body) };
            } else if (payload.statusCode) {
              throw new Error(
                `AI Lambda returned error: ${payload.statusCode} - ${
                  payload.body || JSON.stringify(payload)
                }`
              );
            }
            return { data: payload };
          },
          { maxAttempts: 3, initialDelayMs: 100 }
        );

        const generatedName = (aiResponse.data.text || "").trim();
        // Sanitize filename: remove invalid characters, limit length, ensure .docx extension
        if (generatedName && generatedName.length > 0) {
          const sanitized = generatedName
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // Remove invalid filename chars
            .replace(/\s+/g, "_") // Replace spaces with underscores
            .replace(/_{2,}/g, "_") // Replace multiple underscores with single
            .replace(/^_+|_+$/g, "") // Remove leading/trailing underscores
            .substring(0, 60); // Limit length

          if (sanitized.length > 0) {
            fileName = `${sanitized}.docx`;
          }
        }
      } catch (error: any) {
        console.warn(
          "Failed to generate AI filename, using fallback:",
          error.message
        );
        // Fallback to document title or generic name
        fileName = `${doc.title || "export"}.docx`;
      }

      // Generate .docx using docx library (plain text MVP)
      // Split by newlines and create paragraphs (empty lines become empty paragraphs)
      const paragraphs = doc.draft_text.split("\n").map(
        (line: string) =>
          new Paragraph({
            children: line.trim() ? [new TextRun(line)] : [new TextRun("")],
          })
      );

      const docxDocument = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs,
          },
        ],
      });

      const docxBuffer = await Packer.toBuffer(docxDocument);

      // Upload to S3
      const exportBucket = process.env.S3_EXPORT_BUCKET;
      if (!exportBucket) {
        return res.status(500).json({ error: "Export bucket not configured" });
      }

      const timestamp = Date.now();
      // Use sanitized filename for S3 key (but keep original format for internal tracking)
      const sanitizedS3FileName = fileName.replace(
        /[<>:"/\\|?*\x00-\x1f]/g,
        "_"
      );
      const s3Key = `exports/${documentId}-${timestamp}-${sanitizedS3FileName}`;

      // Upload to S3 with retry logic
      await retry(
        async () =>
          s3Client.send(
            new PutObjectCommand({
              Bucket: exportBucket,
              Key: s3Key,
              Body: docxBuffer,
              ContentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ContentDisposition: `attachment; filename="${fileName}"`,
            })
          ),
        { maxAttempts: 5, initialDelayMs: 100 }
      );

      // Save export metadata (expires in 14 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      const exportResult = await query(
        `INSERT INTO exports (document_id, s3_key, expires_at) 
         VALUES ($1, $2, $3) 
         RETURNING id, created_at`,
        [documentId, s3Key, expiresAt.toISOString()]
      );

      // Generate presigned download URL (15 min expiry) with retry logic
      // Use ResponseContentDisposition to ensure correct filename in download
      const downloadCommand = new GetObjectCommand({
        Bucket: exportBucket,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      });

      const downloadUrl = await retry(
        async () =>
          getSignedUrl(s3Client, downloadCommand, {
            expiresIn: 900,
          }),
        { maxAttempts: 3, initialDelayMs: 100 }
      );

      res.json({
        success: true,
        exportId: exportResult.rows[0].id,
        downloadUrl,
        expiresIn: 900,
        s3Key,
        fileName, // Return the generated filename for frontend use
      });
    } catch (error: any) {
      console.error("Export error:", error);
      res.status(500).json({
        error: "Failed to export document",
        message: error.message,
      });
    }
  }
);

/**
 * GET /exports
 * List all exports for the authenticated user
 */
router.get(
  "/exports",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Fetch user's exports joined with document info
      const result = await query(
        `SELECT 
         e.id, 
         e.document_id, 
         e.s3_key, 
         e.created_at, 
         e.expires_at,
         d.title as document_title
       FROM exports e
       JOIN documents d ON e.document_id = d.id
       WHERE d.owner_id = $1
       ORDER BY e.created_at DESC`,
        [userId]
      );

      const exportBucket = process.env.S3_EXPORT_BUCKET;

      // Generate download URLs for each export
      const exportsWithUrls = await Promise.all(
        result.rows.map(async (exp) => {
          // Check if expired
          const now = new Date();
          const expiresAt = new Date(exp.expires_at);
          const isExpired = now > expiresAt;

          let downloadUrl = null;
          if (!isExpired) {
            try {
              const downloadCommand = new GetObjectCommand({
                Bucket: exportBucket,
                Key: exp.s3_key,
              });
              downloadUrl = await retry(
                async () =>
                  getSignedUrl(s3Client, downloadCommand, {
                    expiresIn: 900,
                  }),
                { maxAttempts: 3, initialDelayMs: 100 }
              );
            } catch (err) {
              console.error(
                `Failed to generate URL for export ${exp.id}:`,
                err
              );
            }
          }

          return {
            id: exp.id,
            documentId: exp.document_id,
            documentTitle: exp.document_title,
            fileName: exp.s3_key.split("/").pop(),
            createdAt: exp.created_at,
            expiresAt: exp.expires_at,
            isExpired,
            downloadUrl,
          };
        })
      );

      res.json({ exports: exportsWithUrls });
    } catch (error: any) {
      console.error("Failed to fetch exports:", error);
      res.status(500).json({
        error: "Failed to fetch exports",
        message: error.message,
      });
    }
  }
);

export default router;
