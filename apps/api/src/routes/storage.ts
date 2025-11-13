import express, { Request, Response } from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { authenticateToken } from "../middleware/auth";
import { retry } from "../lib/retry";

const router = express.Router();
router.use(express.json());

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.REGION || "us-east-1",
});

// Get file extension from content type or filename
function getExtension(contentType?: string, fileName?: string): string {
  if (fileName) {
    const match = fileName.match(/\.([^.]+)$/);
    if (match) return match[1];
  }

  // Map common MIME types to extensions
  const mimeMap: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/msword": "doc",
    "text/plain": "txt",
  };

  if (contentType) {
    const baseType = contentType.split(";")[0].trim();
    return mimeMap[baseType] || "bin";
  }

  return "bin";
}

/**
 * POST /documents/upload-url
 * Generate a presigned PUT URL for direct S3 upload
 * Requires authentication
 */
router.post(
  "/upload-url",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { contentType, fileName } = req.body;

      if (!contentType) {
        return res.status(400).json({
          error: "contentType is required",
        });
      }

      const uploadBucket = process.env.S3_UPLOAD_BUCKET;
      if (!uploadBucket) {
        console.error("S3_UPLOAD_BUCKET environment variable not set");
        return res.status(500).json({
          error: "Server configuration error",
        });
      }

      const extension = getExtension(contentType, fileName);
      const key = `uploads/${uuidv4()}.${extension}`;

      const command = new PutObjectCommand({
        Bucket: uploadBucket,
        Key: key,
        ContentType: contentType,
      });

      // Generate presigned URL with retry logic
      const uploadUrl = await retry(
        async () =>
          getSignedUrl(s3Client, command, {
            expiresIn: 900, // 15 minutes
          }),
        { maxAttempts: 3, initialDelayMs: 100 }
      );

      res.json({
        uploadUrl,
        key,
        bucket: uploadBucket,
        expiresIn: 900,
      });
    } catch (error: any) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({
        error: "Failed to generate upload URL",
        message: error.message,
      });
    }
  }
);

/**
 * POST /documents/download-url
 * Generate a presigned GET URL for S3 object download
 * Requires authentication
 */
router.post(
  "/download-url",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { key, bucket } = req.body;

      if (!key || !bucket) {
        return res.status(400).json({
          error: "key and bucket are required",
        });
      }

      // Validate bucket name matches expected pattern
      const uploadBucket = process.env.S3_UPLOAD_BUCKET;
      const exportBucket = process.env.S3_EXPORT_BUCKET;

      if (bucket !== uploadBucket && bucket !== exportBucket) {
        return res.status(400).json({
          error: "Invalid bucket name",
        });
      }

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      // Generate presigned URL with retry logic
      const downloadUrl = await retry(
        async () =>
          getSignedUrl(s3Client, command, {
            expiresIn: 900, // 15 minutes
          }),
        { maxAttempts: 3, initialDelayMs: 100 }
      );

      res.json({
        downloadUrl,
        expiresIn: 900,
      });
    } catch (error: any) {
      console.error("Error generating download URL:", error);
      res.status(500).json({
        error: "Failed to generate download URL",
        message: error.message,
      });
    }
  }
);

export default router;
