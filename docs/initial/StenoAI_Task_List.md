# StenoAI — Final Task List & PR Roadmap (AWS CLI only)

> All infrastructure configured and deployed via AWS CLI. You will only step in for IAM permissions if required. All frontend and backend work must deploy and run on AWS without manual intervention.

---

## PR 1 — Minimal Monorepo & Local Tooling (no infra)

Creates only:

```
/apps/web/ (Vite React placeholder)
/apps/api/ (Node/Express Lambda handler with GET /health)
/apps/ai/ (Python FastAPI skeleton)
/scripts/env.sh (exports ENV/REGION/APP)
Makefile
.env.example
```

Acceptance: `npm --prefix apps/web run build` → dist/; `make api-zip` → apps/api/dist/api.zip.

---

## PR 2 — Static Hosting Online (S3 + CloudFront)

Creates only:

```
/scripts/web_create.sh
/infra/web/cloudfront.json
```

Acceptance: CloudFront domain shows the placeholder page.

---

## PR 3 — API Online (Lambda + API Gateway HTTP API)

Creates only:

```
/scripts/api_create.sh
/infra/api/iam-role-trust.json
/infra/api/lambda-basic-policy.json
```

Acceptance: API Gateway endpoint returns `{status:"ok"}`.

---

## PR 4 — Public Upload/Download APIs (S3 Presigned URLs)

Creates only:

```
/apps/api/src/routes/storage.ts
/scripts/data_buckets_create.sh
```

Tasks: Create S3 buckets for uploads and exports; grant Lambda S3 permissions.
Acceptance: Upload and download URLs function correctly.

---

## PR 5 — Network Hardening: VPC + RDS + VPC Endpoints + Secrets Manager

Creates only:

```
/scripts/vpc_create.sh
/scripts/vpc_endpoints.sh
/scripts/rds_create.sh
/scripts/migrate.sh
/apps/api/src/db/pg.ts
```

Tasks:

- Create private VPC, subnets, security groups.
- Add endpoints for Bedrock, S3, Secrets Manager.
- Deploy Postgres in private subnet.
- Store DB credentials in Secrets Manager.
- Implement pg-pool connection pooling in pg.ts.
  Acceptance: /health/db returns `{db:"ok"}`.

---

## PR 6 — DB Schema & Migrations

Creates only:

```
/apps/api/migrations/0001_init.sql
```

Tables: users, templates (with is_global), documents (with status), refinements, document_collaborators, exports.
Acceptance: `bash scripts/migrate.sh` initializes schema successfully.

---

## PR 7 — Auth Backend (JWT)

Creates only:

```
/apps/api/src/routes/auth.ts
/apps/api/src/middleware/auth.ts
```

Acceptance: User signup/login, token issuance, and protected routes functional.

---

## PR 8 — Auth Frontend + Routing

Creates only:

```
/apps/web/src/pages/{Home.tsx,Login.tsx,Signup.tsx,Dashboard.tsx}
/apps/web/src/lib/auth.ts
/apps/web/src/AppRouter.tsx
```

Dashboard shows: document list (title, status, created_at), "Upload" button, "New Template" button, recent templates list.
Acceptance: Login sets httpOnly cookie; routing and redirect behavior verified; Dashboard displays mock data.

---

## PR 9 — Ingest + Basic Extraction

Creates only:

```
/apps/api/src/routes/ingest.ts
/apps/api/src/lib/extract_basic.ts
```

Acceptance: File upload and text extraction store successfully.

---

## PR 10 — Chunking & Merge for Large Files

Creates only:

```
/apps/api/src/lib/extract_chunked.ts
/apps/api/src/lib/merge.ts
```

Acceptance: Large files processed and merged successfully.

---

## PR 11 — Templates CRUD + Upload Page + Unified Editor

Creates only:

```
/apps/api/src/routes/templates.ts
/apps/web/src/pages/{Upload.tsx,Templates.tsx,TemplateEditor.tsx,Editor.tsx}
```

Upload redirects to `/documents/:id` after ingestion.
Editor has: sidebar (extracted text), main pane (draft), template selector dropdown, Generate/Refine/Export buttons, refinement prompt input.
Acceptance: Template CRUD works; upload-to-editor flow operational; editor layout complete.

---

## PR 12 — AI Draft Generation (Bedrock)

Creates only:

```
/apps/ai/main.py
/apps/api/src/routes/generate.ts
/apps/api/src/lib/composePrompt.ts
/apps/web/src/pages/Editor.tsx
```

Acceptance: Draft generation returns valid text and saves to DB.

---

## PR 13 — AI Refinement + History

Creates only:

```
/apps/api/src/routes/refine.ts
/apps/api/migrations/0002_refinements.sql
/apps/web/src/pages/History.tsx
```

Acceptance: Refinements stored in DB, visible in History view.

---

## PR 14 — Real-time Collaboration (Y.js + WebSocket)

Creates only:

```
/apps/api/src/realtime/ws_handler.ts
/apps/api/src/realtime/persist.ts
/apps/web/src/lib/collab/yjs.ts
/apps/api/migrations/0003_collab.sql
/scripts/ws_create.sh
```

Collab integrated into unified `/documents/:id` editor (no separate /collab route).
WebSocket protocol: join with documentId, broadcast Y.js updates, persist snapshots + ops.
Acceptance: Two browser tabs editing same doc see updates live; reconnect syncs state correctly.

---

## PR 15 — Export to Word + Exports Page

Creates only:

```
/apps/api/src/routes/export.ts
/apps/web/src/pages/Exports.tsx
```

Export saves to S3 + `exports` table; `/exports` page fetches `GET /exports` and lists files with download links.
Acceptance: Exported Word doc opens with plain text formatting; Exports page shows list with expiry dates.

---

## PR 16 — Error Handling, Retries, and Idempotency

Creates only:

```
/apps/api/src/middleware/errors.ts
/apps/api/src/lib/retry.ts
/apps/api/src/middleware/idempotency.ts
/apps/web/src/components/ErrorBoundary.tsx
```

Acceptance: Transient failures recover; no duplicate submissions.

---

## PR 17 — Object Lifecycle Management

Creates only:

```
/scripts/s3_lifecycle.sh
```

Tasks: Configure S3 lifecycle for cost optimization.
Acceptance: Lifecycle rules applied correctly.

---

## PR 18 — Custom Prompts + Prompts Page

Creates only:

```
/apps/api/migrations/0004_user_prompts.sql
/apps/api/src/routes/prompts.ts
/apps/web/src/pages/Prompts.tsx
```

Acceptance: Custom prompts saved and selectable in editor.

---

## PR 19 — Testing (Unit + Integration + E2E)

Creates only:

```
/apps/api/test/*.spec.ts
/apps/web/e2e/*.spec.ts
/scripts/test_e2e.sh
```

Acceptance: All suites pass, covering upload, generate, refine, export.

---

## PR 20 — Sample Data & Test Files Generator

Creates only:

```
/apps/api/src/routes/testdata.ts
/apps/web/src/pages/SampleLoader.tsx
```

Acceptance: Running seed populates templates, documents, and test files.
