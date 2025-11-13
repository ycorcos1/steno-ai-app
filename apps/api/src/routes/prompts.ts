import express, { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { query } from "../db/pg";

interface PromptRow {
  id: string;
  name: string;
  body: string;
  created_at: string;
}

const router = express.Router();
router.use(express.json());
router.use(authenticateToken);

function validatePromptInput(
  name: unknown,
  body: unknown
): { name: string; body: string } | null {
  if (typeof name !== "string" || name.trim().length === 0) {
    return null;
  }

  if (name.trim().length > 255) {
    return null;
  }

  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }

  return {
    name: name.trim(),
    body: body.trim(),
  };
}

// GET /prompts - List all user's prompts
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  try {
    const result = await query(
      `
        SELECT id, name, body, created_at
        FROM user_prompts
        WHERE owner_id = $1
        ORDER BY created_at DESC
      `,
      [userId]
    );

    const prompts = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      body: row.body,
      createdAt: row.created_at,
    }));

    res.json({ prompts });
  } catch (error) {
    console.error("Failed to fetch prompts:", error);
    res.status(500).json({ error: "Failed to load prompts" });
  }
});

// GET /prompts/:id - Get single prompt
router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  try {
    const result = await query(
      `
        SELECT id, name, body, created_at
        FROM user_prompts
        WHERE id = $1 AND owner_id = $2
      `,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }

    const row = result.rows[0] as PromptRow;
    res.json({
      prompt: {
        id: row.id,
        name: row.name,
        body: row.body,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error("Failed to fetch prompt:", error);
    res.status(500).json({ error: "Failed to load prompt" });
  }
});

// POST /prompts - Create new prompt
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const validated = validatePromptInput(req.body.name, req.body.body);
  if (!validated) {
    res
      .status(400)
      .json({ error: "Name must be <=255 chars and body is required" });
    return;
  }

  try {
    const result = await query(
      `
        INSERT INTO user_prompts (owner_id, name, body)
        VALUES ($1, $2, $3)
        RETURNING id, name, body, created_at
      `,
      [userId, validated.name, validated.body]
    );

    const row = result.rows[0] as PromptRow;
    res.status(201).json({
      prompt: {
        id: row.id,
        name: row.name,
        body: row.body,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error("Failed to create prompt:", error);
    res.status(500).json({ error: "Failed to create prompt" });
  }
});

// PUT /prompts/:id - Update prompt
router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const promptId = req.params.id;

  try {
    const existing = await query(
      `
        SELECT owner_id
        FROM user_prompts
        WHERE id = $1
      `,
      [promptId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }

    const promptOwnerId = existing.rows[0].owner_id as string | null;

    if (!promptOwnerId || promptOwnerId !== userId) {
      res.status(403).json({ error: "Not authorized to update prompt" });
      return;
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (req.body.name !== undefined) {
      if (
        typeof req.body.name !== "string" ||
        req.body.name.trim().length === 0
      ) {
        res.status(400).json({ error: "Name cannot be empty" });
        return;
      }
      if (req.body.name.trim().length > 255) {
        res.status(400).json({ error: "Name must be <=255 chars" });
        return;
      }
      updates.push(`name = $${paramIndex}`);
      values.push(req.body.name.trim());
      paramIndex++;
    }

    if (req.body.body !== undefined) {
      if (
        typeof req.body.body !== "string" ||
        req.body.body.trim().length === 0
      ) {
        res.status(400).json({ error: "Body cannot be empty" });
        return;
      }
      updates.push(`body = $${paramIndex}`);
      values.push(req.body.body.trim());
      paramIndex++;
    }

    if (updates.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(promptId, userId);

    const result = await query(
      `
        UPDATE user_prompts
        SET ${updates.join(", ")}
        WHERE id = $${paramIndex} AND owner_id = $${paramIndex + 1}
        RETURNING id, name, body, created_at
      `,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }

    const row = result.rows[0] as PromptRow;
    res.json({
      prompt: {
        id: row.id,
        name: row.name,
        body: row.body,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error("Failed to update prompt:", error);
    res.status(500).json({ error: "Failed to update prompt" });
  }
});

// DELETE /prompts/:id - Delete prompt
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const promptId = req.params.id;

  try {
    const existing = await query(
      `
        SELECT owner_id
        FROM user_prompts
        WHERE id = $1
      `,
      [promptId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }

    const promptOwnerId = existing.rows[0].owner_id as string | null;

    if (!promptOwnerId || promptOwnerId !== userId) {
      res.status(403).json({ error: "Not authorized to delete prompt" });
      return;
    }

    await query("DELETE FROM user_prompts WHERE id = $1 AND owner_id = $2", [
      promptId,
      userId,
    ]);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete prompt:", error);
    res.status(500).json({ error: "Failed to delete prompt" });
  }
});

export default router;
