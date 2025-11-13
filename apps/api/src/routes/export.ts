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
      const s3Key = `exports/${documentId}-${timestamp}.docx`;

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
      const downloadCommand = new GetObjectCommand({
        Bucket: exportBucket,
        Key: s3Key,
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
