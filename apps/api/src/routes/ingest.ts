import express, { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";
import { extractText } from "../lib/extract_basic";
import { chunkText, needsChunking } from "../lib/extract_chunked";
import { v4 as uuidv4 } from "uuid";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();
router.use(express.json());

const s3Client = new S3Client({
  region: process.env.REGION || "us-east-1",
});

/**
 * POST /documents/ingest
 * Process uploaded file and extract text
 * Requires authentication via JWT cookie
 */
router.post(
  "/ingest",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { key, originalName, mime, size } = req.body;

      // Validate required fields
      if (!key || !originalName || !mime || !size) {
        return res.status(400).json({
          error: "Missing required fields: key, originalName, mime, size",
        });
      }

      // Get authenticated user ID
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Determine which bucket the file is in
      const uploadBucket = process.env.S3_UPLOAD_BUCKET;
      if (!uploadBucket) {
        console.error("S3_UPLOAD_BUCKET not configured");
        return res.status(500).json({ error: "Server configuration error" });
      }

      // Extract text from file
      let extractedText: string;
      try {
        extractedText = await extractText(uploadBucket, key, mime);
      } catch (extractError: any) {
        console.error("Text extraction failed:", extractError);
        return res.status(422).json({
          error: "Failed to extract text from file",
          message: extractError.message,
        });
      }

      // Derive title from original filename (remove extension)
      // Truncate to 255 chars to match database VARCHAR(255) constraint
      const title = originalName.replace(/\.[^/.]+$/, "").substring(0, 255);

      // Check if document needs chunking
      const isChunked = needsChunking(extractedText);
      let chunkCount = 0;

      // Insert document into database
      const documentId = uuidv4();
      const insertQuery = `
        INSERT INTO documents (id, owner_id, key, title, extracted_text, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id, title, status, created_at
      `;

      const result = await query(insertQuery, [
        documentId,
        userId,
        key,
        title,
        extractedText,
        "extracted",
      ]);

      const document = result.rows[0];

      // If chunking needed, create chunks and store in doc_chunks table
      if (isChunked) {
        const chunks = chunkText(extractedText);
        chunkCount = chunks.length;

        // Insert each chunk into doc_chunks table
        for (const chunk of chunks) {
          await query(
            `INSERT INTO doc_chunks (document_id, idx, start, "end", summary)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              documentId,
              chunk.idx,
              chunk.start,
              chunk.end,
              chunk.summary || null,
            ]
          );
        }
      }

      res.status(201).json({
        documentId: document.id,
        title: document.title,
        status: document.status,
        extractedLength: extractedText.length,
        isChunked,
        ...(isChunked && { chunkCount }),
        createdAt: document.created_at,
      });
    } catch (error: any) {
      console.error("Ingestion error:", error);
      res.status(500).json({
        error: "Ingestion failed",
        message: error.message,
      });
    }
  }
);

/**
 * GET /documents/:id
 * Get document details including extracted text and draft
 * Requires authentication via JWT cookie
 */
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch document and verify ownership
    const result = await query(
      `SELECT id, owner_id, key, title, extracted_text, draft_text, status, created_at, updated_at
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    const doc = result.rows[0];
    res.json({
      document: {
        id: doc.id,
        title: doc.title,
        extractedText: doc.extracted_text || "",
        draftText: doc.draft_text || "",
        status: doc.status,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Failed to fetch document:", error);
    res.status(500).json({
      error: "Failed to fetch document",
      message: error.message,
    });
  }
});

/**
 * GET /documents
 * List all documents for the authenticated user
 * Requires authentication via JWT cookie
 */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch user's documents
    const result = await query(
      `SELECT id, title, extracted_text, draft_text, status, created_at, updated_at
       FROM documents
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const documents = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      extractedText: row.extracted_text || "",
      draftText: row.draft_text || "",
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ documents });
  } catch (error: any) {
    console.error("Failed to fetch documents:", error);
    res.status(500).json({
      error: "Failed to fetch documents",
      message: error.message,
    });
  }
});

/**
 * PUT /documents/:id/draft
 * Save draft text for a document
 * Requires authentication via JWT cookie
 */
router.put(
  "/:id/draft",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { draftText } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      if (typeof draftText !== "string") {
        return res.status(400).json({ error: "draftText must be a string" });
      }

      // Verify document ownership
      const result = await query(
        `SELECT id, owner_id
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Update draft text
      await query(
        `UPDATE documents
         SET draft_text = $1, updated_at = NOW()
         WHERE id = $2 AND owner_id = $3`,
        [draftText, id, userId]
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("Failed to save draft:", error);
      res.status(500).json({
        error: "Failed to save draft",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /documents/:id
 * Delete a document and its associated files
 * Requires authentication via JWT cookie
 */
router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Fetch document and verify ownership
      const result = await query(
        `SELECT id, owner_id, key
         FROM documents
         WHERE id = $1 AND owner_id = $2`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const doc = result.rows[0];
      const s3Key = doc.key;

      // Delete the S3 file if it exists
      const uploadBucket = process.env.S3_UPLOAD_BUCKET;
      if (uploadBucket && s3Key) {
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: uploadBucket,
            Key: s3Key,
          });
          await s3Client.send(deleteCommand);
          console.log(`Deleted S3 file: ${s3Key}`);
        } catch (s3Error: any) {
          // Log but don't fail if S3 deletion fails (file might not exist)
          console.warn(`Failed to delete S3 file ${s3Key}:`, s3Error.message);
        }
      }

      // Delete the document from database
      // Related records (refinements, doc_chunks, exports, etc.) will be
      // automatically deleted due to ON DELETE CASCADE foreign key constraints
      await query("DELETE FROM documents WHERE id = $1 AND owner_id = $2", [
        id,
        userId,
      ]);

      res.status(204).send();
    } catch (error: any) {
      console.error("Failed to delete document:", error);
      res.status(500).json({
        error: "Failed to delete document",
        message: error.message,
      });
    }
  }
);

export default router;
