import express, { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";

interface TemplateRow {
  id: string;
  title: string;
  content: string;
  is_global: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

interface TemplateResponse {
  id: string;
  title: string;
  content: string;
  isGlobal: boolean;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
}

const router = express.Router();
router.use(express.json());
router.use(authenticateToken);

function mapTemplate(row: TemplateRow, userId: string): TemplateResponse {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isGlobal: row.is_global,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: Boolean(row.owner_id && row.owner_id === userId),
  };
}

function validateTemplateInput(
  title: unknown,
  content: unknown
): { title: string; content: string } | null {
  if (typeof title !== "string" || title.trim().length === 0) {
    return null;
  }

  if (title.trim().length > 255) {
    return null;
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  return {
    title: title.trim(),
    content: content.trim(),
  };
}

router.get("/", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  try {
    const result = await query(
      `
        SELECT id, title, content, is_global, owner_id, created_at, updated_at, last_used_at
        FROM templates
        WHERE owner_id = $1 OR is_global = true
        ORDER BY 
          CASE WHEN last_used_at IS NOT NULL THEN 0 ELSE 1 END,
          last_used_at DESC NULLS LAST,
          updated_at DESC
      `,
      [userId]
    );

    const templates = result.rows.map((row) =>
      mapTemplate(row as TemplateRow, userId)
    );

    res.json({ templates });
  } catch (error) {
    console.error("Failed to fetch templates:", error);
    res.status(500).json({ error: "Failed to load templates" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  try {
    const result = await query(
      `
        SELECT id, title, content, is_global, owner_id, created_at, updated_at
        FROM templates
        WHERE id = $1 AND (owner_id = $2 OR is_global = true)
      `,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const template = mapTemplate(result.rows[0] as TemplateRow, userId);
    res.json({ template });
  } catch (error) {
    console.error("Failed to fetch template:", error);
    res.status(500).json({ error: "Failed to load template" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const validated = validateTemplateInput(req.body.title, req.body.content);
  if (!validated) {
    res
      .status(400)
      .json({ error: "Title must be <=255 chars and content is required" });
    return;
  }

  try {
    const result = await query(
      `
        INSERT INTO templates (title, content, owner_id, is_global)
        VALUES ($1, $2, $3, false)
        RETURNING id, title, content, is_global, owner_id, created_at, updated_at
      `,
      [validated.title, validated.content, userId]
    );

    const template = mapTemplate(result.rows[0] as TemplateRow, userId);
    res.status(201).json({ template });
  } catch (error) {
    console.error("Failed to create template:", error);
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const templateId = req.params.id;

  try {
    const existing = await query(
      `
        SELECT owner_id, is_global
        FROM templates
        WHERE id = $1
      `,
      [templateId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const templateOwnerId = existing.rows[0].owner_id as string | null;
    const isGlobal = existing.rows[0].is_global as boolean;

    if (!templateOwnerId || templateOwnerId !== userId) {
      res.status(403).json({ error: "Not authorized to update template" });
      return;
    }

    if (isGlobal) {
      res
        .status(403)
        .json({ error: "Global templates cannot be modified by users" });
      return;
    }

    const validated = validateTemplateInput(req.body.title, req.body.content);
    if (!validated) {
      res
        .status(400)
        .json({ error: "Title must be <=255 chars and content is required" });
      return;
    }

    const result = await query(
      `
        UPDATE templates
        SET title = $1,
            content = $2,
            updated_at = NOW()
        WHERE id = $3 AND owner_id = $4
        RETURNING id, title, content, is_global, owner_id, created_at, updated_at
      `,
      [validated.title, validated.content, templateId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const template = mapTemplate(result.rows[0] as TemplateRow, userId);
    res.json({ template });
  } catch (error) {
    console.error("Failed to update template:", error);
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const templateId = req.params.id;

  try {
    const existing = await query(
      `
        SELECT owner_id, is_global
        FROM templates
        WHERE id = $1
      `,
      [templateId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const templateOwnerId = existing.rows[0].owner_id as string | null;
    const isGlobal = existing.rows[0].is_global as boolean;

    if (!templateOwnerId || templateOwnerId !== userId) {
      res.status(403).json({ error: "Not authorized to delete template" });
      return;
    }

    if (isGlobal) {
      res
        .status(403)
        .json({ error: "Global templates cannot be deleted by users" });
      return;
    }

    await query("DELETE FROM templates WHERE id = $1 AND owner_id = $2", [
      templateId,
      userId,
    ]);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete template:", error);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
