import request from "supertest";
import express from "express";
import exportRouter from "../export";
import { authenticateToken } from "../../middleware/auth";
import { query } from "../../db/pg";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Mock dependencies
jest.mock("../../middleware/auth");
jest.mock("../../db/pg");
jest.mock("@aws-sdk/client-s3");
jest.mock("@aws-sdk/s3-request-presigner");
jest.mock("docx", () => ({
  Document: jest.fn().mockImplementation(() => ({})),
  Paragraph: jest.fn().mockImplementation(() => ({})),
  TextRun: jest.fn().mockImplementation(() => ({})),
  Packer: {
    toBuffer: jest.fn().mockResolvedValue(Buffer.from("mock-docx-content")),
  },
}));

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<
  typeof authenticateToken
>;
const mockQuery = query as jest.MockedFunction<typeof query>;
const mockS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockPutObjectCommand = PutObjectCommand as jest.MockedClass<
  typeof PutObjectCommand
>;
const mockGetObjectCommand = GetObjectCommand as jest.MockedClass<
  typeof GetObjectCommand
>;
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

describe("Export Routes", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/documents", exportRouter);
    app.use("/", exportRouter);

    // Reset mocks
    jest.clearAllMocks();

    // Default mock implementations
    mockAuthenticateToken.mockImplementation(async (req, res, next) => {
      req.user = { userId: "test-user-id", email: "test@example.com" };
      next();
    });

    process.env.S3_EXPORT_BUCKET = "test-exports-bucket";
    process.env.REGION = "us-east-1";
  });

  describe("POST /documents/export/:id", () => {
    it("should return 401 if not authenticated", async () => {
      mockAuthenticateToken.mockImplementation(async (req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const response = await request(app)
        .post("/documents/export/test-doc-id")
        .set("Idempotency-Key", "test-export-401")
        .send({});

      expect(response.status).toBe(401);
    });

    it("should return 404 if document not found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app)
        .post("/documents/export/non-existent-id")
        .set("Idempotency-Key", "test-export-404")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Document not found");
    });

    it("should return 403 if user does not own document", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-id",
            owner_id: "different-user-id",
            title: "Test Doc",
            draft_text: "Test content",
          },
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app)
        .post("/documents/export/doc-id")
        .set("Idempotency-Key", "test-export-403")
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Access denied");
    });

    it("should return 400 if document has no draft text", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-id",
            owner_id: "test-user-id",
            title: "Test Doc",
            draft_text: null,
          },
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app)
        .post("/documents/export/doc-id")
        .set("Idempotency-Key", "test-export-no-draft")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("no draft to export");
    });

    it("should successfully export document and return download URL", async () => {
      const mockDocument = {
        id: "doc-id",
        owner_id: "test-user-id",
        title: "Test Document",
        draft_text: "This is test draft content\nWith multiple lines",
      };

      mockQuery
        .mockResolvedValueOnce({
          rows: [mockDocument],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        } as any)
        .mockResolvedValueOnce({
          rows: [{ id: "export-id", created_at: new Date() }],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: [],
        } as any);

      // Mock S3 operations
      const mockSend = jest.fn().mockResolvedValue({});
      const mockS3Instance = {
        send: mockSend,
      };
      mockS3Client.mockImplementation(() => mockS3Instance as any);

      mockGetSignedUrl.mockResolvedValue(
        "https://s3-presigned-url.com/file.docx"
      );

      const response = await request(app)
        .post("/documents/export/doc-id")
        .set("Idempotency-Key", "test-export-success")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.exportId).toBe("export-id");
      expect(response.body.downloadUrl).toBe(
        "https://s3-presigned-url.com/file.docx"
      );
      expect(response.body.s3Key).toContain("exports/doc-id-");

      // Verify database insert was called
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall?.[0]).toContain("INSERT INTO exports");
      expect(insertCall?.[1]?.[0]).toBe("doc-id"); // document_id
      expect(insertCall?.[1]?.[1]).toContain("exports/doc-id-"); // s3_key

      // Verify S3 upload was called
      // Note: S3Client is instantiated at module level, so we verify the command was created
      expect(mockPutObjectCommand).toHaveBeenCalled();
    });

    it("should return 500 if S3 bucket not configured", async () => {
      delete process.env.S3_EXPORT_BUCKET;

      const mockDocument = {
        id: "doc-id",
        owner_id: "test-user-id",
        title: "Test Document",
        draft_text: "Test content",
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockDocument],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app)
        .post("/documents/export/doc-id")
        .set("Idempotency-Key", "test-export-s3-error")
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Export bucket not configured");
    });
  });

  describe("GET /exports", () => {
    it("should return 401 if not authenticated", async () => {
      mockAuthenticateToken.mockImplementation(async (req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const response = await request(app).get("/exports");

      expect(response.status).toBe(401);
    });

    it("should return empty array if user has no exports", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app).get("/exports");

      expect(response.status).toBe(200);
      expect(response.body.exports).toEqual([]);
    });

    it("should return exports list with download URLs", async () => {
      // Create future date (not expired)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);

      // Create past date (expired)
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const mockExports = [
        {
          id: "export-1",
          document_id: "doc-1",
          s3_key: "exports/doc-1-1234567890.docx",
          created_at: new Date("2024-01-01"),
          expires_at: futureDate,
          document_title: "Document 1",
        },
        {
          id: "export-2",
          document_id: "doc-2",
          s3_key: "exports/doc-2-1234567891.docx",
          created_at: new Date("2024-01-02"),
          expires_at: pastDate, // Expired
          document_title: "Document 2",
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: mockExports,
        rowCount: 2,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      mockGetSignedUrl
        .mockResolvedValueOnce("https://s3-presigned-url.com/export-1.docx")
        .mockResolvedValueOnce("https://s3-presigned-url.com/export-2.docx");

      const response = await request(app).get("/exports");

      expect(response.status).toBe(200);
      expect(response.body.exports).toHaveLength(2);
      expect(response.body.exports[0]).toMatchObject({
        id: "export-1",
        documentId: "doc-1",
        documentTitle: "Document 1",
        fileName: "doc-1-1234567890.docx",
        isExpired: false,
        downloadUrl: "https://s3-presigned-url.com/export-1.docx",
      });
      expect(response.body.exports[1].isExpired).toBe(true);
    });

    it("should handle expired exports correctly", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 15); // 15 days ago (expired)

      const mockExports = [
        {
          id: "export-1",
          document_id: "doc-1",
          s3_key: "exports/doc-1-1234567890.docx",
          created_at: new Date("2024-01-01"),
          expires_at: pastDate,
          document_title: "Document 1",
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: mockExports,
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as any);

      const response = await request(app).get("/exports");

      expect(response.status).toBe(200);
      expect(response.body.exports[0].isExpired).toBe(true);
      expect(response.body.exports[0].downloadUrl).toBeNull();
    });
  });
});
