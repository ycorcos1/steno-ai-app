# StenoAI — Product Requirements Document (Updated)

## 1. Overview

**Project Name:** StenoAI  
**Goal:** Build an AI-powered legal drafting assistant that generates, refines, and exports professional demand letters based on firm-approved templates and user-uploaded documents.

Users can upload legal files, apply customizable templates, and collaborate in real time while generating and editing drafts powered by Amazon Bedrock AI models. The platform is fully hosted on AWS and designed to operate as a secure, scalable, and serverless SaaS.

---

## 2. Target Users

1. **Attorneys / Legal Staff** – Upload client or case data, generate AI-assisted drafts, refine them, and export polished demand letters.
2. **Law Firm Administrators** – Manage templates, oversee team collaboration, and control access permissions.

---

## 3. Objectives

- Automate the drafting of demand letters using AI and firm templates.
- Reduce manual writing and editing time.
- Enable secure collaboration and version control.
- Support large, complex documents reliably.
- Provide a scalable and cost-efficient AWS-hosted environment.

---

## 4. Functional Requirements

### 4.1 Authentication & User Flow

- **Signup/Login** using email + password (JWT-based authentication).
- If not logged in → user lands on **Home page** (`/`).
- If logged in → redirected to **Dashboard** (`/dashboard`).
- Authenticated users access all private routes (Dashboard, Upload, Editor, etc.).
- JWTs stored securely in browser using **httpOnly cookies** (set by backend on login). Requires API Gateway to handle CORS with credentials.
- Token expiry: **24 hours**. No refresh token in MVP; users re-authenticate after expiry.

**Frontend Pages**
| Route | Description |
|-------|--------------|
| `/` | Public homepage explaining product. |
| `/login` | Login page for existing users. |
| `/signup` | Registration page for new users. |
| `/dashboard` | Central hub: lists user's documents (title, status, created_at), quick actions (Upload, New Template), recent templates. |
| `/upload` | File upload & ingestion flow. Redirects to `/documents/:id` after ingestion. |
| `/documents/:id` | **Unified editor**: shows extracted text (sidebar), draft (main pane), template selector, generate/refine/export buttons, refinement prompt input. Real-time collaboration always enabled. |
| `/documents/:id/history` | Revision history: lists all refinements with timestamps. Click to view prompt/response. "Restore" button updates draft to selected version. |
| `/templates` | Template list (personal + global). CRUD actions. |
| `/templates/:id` | Template editor (title, content textarea). |
| `/prompts` | Manage reusable AI prompts (list, create, edit, delete). |
| `/exports` | List of user's exported files with download links and expiry dates. |
| `/testdata` | **Dev-only** sample data generator (button to call `/testdata/seed`). |

---

### 4.2 Document Upload & Ingestion

- Files uploaded via S3 **presigned URLs** (PUT for upload, GET for download).
- After upload, API triggers **ingestion**:
  - Extract text from `.docx` / `.pdf`.
  - Store metadata (file name, MIME type, size, etc.).
  - Generate `documents` DB entry.
- Upload progress tracked in frontend.
- After successful ingestion, user is **redirected to `/documents/:id`** (the editor page) where they can generate a draft.

---

### 4.3 Large File Handling

- Large or complex files are **chunked** into manageable segments (~3–5k tokens).
- Each chunk is processed individually by Bedrock.
- AI responses merged using a **section-aware merge** strategy for coherence.
- Chunk metadata (start, end, summary) stored in `doc_chunks` table for traceability.

---

### 4.4 Template Management

- Users can create, edit, and delete **personal templates** (owned by them).
- Templates can be marked as **firm-wide defaults** via `is_global=true` flag (admin feature, deferred to post-MVP).
- Template picker in Editor shows user's templates + global templates.
- Templates stored in Postgres with version timestamps (`created_at`, `updated_at`).

---

### 4.5 AI Draft Generation

- Users select a document + template + optional prompt instructions.
- Backend composes a prompt combining extracted text and template content.
- Bedrock (Claude 3.x model) invoked through AWS SDK.
- Generated text stored in `documents.draft_text`.
- Users view drafts in the Editor.

---

### 4.6 Refinement

- Users submit natural language instructions to refine the draft.
- AI reprocesses the current draft and updates it.
- Each refinement stored in `refinements(document_id, prompt, response, created_at)` for version history.
- Users can revert or view previous versions.

---

### 4.7 Real-time Collaboration

- **Single unified editor** at `/documents/:id` supports real-time collaboration (no separate `/collab` route).
- **Y.js CRDT** engine ensures conflict-free concurrent edits.
- **Access control**: `document_collaborators` table tracks who can edit each document. Document owner can invite collaborators (deferred to post-MVP; MVP assumes owner-only editing with multi-device support).
- AWS API Gateway WebSocket API + Lambda handle communication.
- **Connection flow**:
  1. Client connects with JWT in query param.
  2. Client sends join message with `documentId`.
  3. Server validates access and syncs client with latest snapshot + ops.
- **Persistent state**:
  - Document snapshots stored every ~100 ops or 5 minutes.
  - Incremental operations stored for replay/resume.
- **Presence indicators**: Show active users (avatar, cursor position) via WebSocket broadcast.

---

### 4.8 Export

- Users export drafts to `.docx` using the Node `docx` library.
- **MVP formatting**: Plain text with basic paragraph styling. Advanced template formatting (letterheads, margins, fonts) deferred to post-MVP.
- Exported files uploaded to S3 `/exports/` bucket; metadata tracked in `exports` table.
- Download via presigned URL (15 min expiry).
- `/exports` page lists all user exports with download buttons (`GET /exports` endpoint).
- Exports auto-expire (14 days via S3 lifecycle rule).

---

### 4.9 Custom Prompts

- Users can save and manage reusable prompt templates.
- Each prompt includes `{name, body, created_at}`.
- Selectable within the Editor for both generation and refinement.

---

### 4.10 Sample Data Generator

- **Developer-only** endpoint (`POST /testdata/seed`) to seed templates, demo documents, and large synthetic files.
- Frontend route `/testdata` gated by environment check: `if (import.meta.env.MODE === 'development')`.

---

## 5. Non-Functional Requirements

### 5.1 Reliability & Error Handling

- All Bedrock, S3, and DB calls include **exponential backoff retries**.
- **Idempotency** enforced for POST routes via `Idempotency-Key` header.
- User-facing **ErrorBoundary** with retry prompts in frontend.

### 5.2 Scalability

- Fully serverless architecture using:
  - AWS Lambda (Node + Python)
  - S3 (static assets + file storage)
  - API Gateway (HTTP + WebSocket)
  - RDS (PostgreSQL)
  - CloudFront (CDN)
- Horizontal scalability via AWS managed services.

### 5.3 Security

- All resources deployed within a **private VPC**.
- **RDS** and **Lambdas** in private subnets.
- **VPC endpoints** for S3, Bedrock, Secrets Manager.
- Secrets stored in **AWS Secrets Manager** — no plaintext `.env` in production.
- Signed URLs ensure controlled access to documents.

### 5.4 Cost Optimization

- S3 lifecycle rules:
  - Delete uploads after 30 days.
  - Delete exports after 14 days.
  - Transition old versions to infrequent access.
- VPC endpoints eliminate NAT Gateway costs.

### 5.5 Testing

- **Unit Tests:** API routes and DB operations.
- **Integration Tests:** Upload → Generate → Refine → Export flow.
- **E2E Tests:** Frontend automation (Cypress/Playwright).
- All run locally or against deployed stack.

---

## 6. Architecture

**Frontend:**  
React (Vite) + TailwindCSS  
State: Context + Y.js (for collaboration)

**Backend:**  
Node.js (Express on AWS Lambda) for APIs  
Python (FastAPI on AWS Lambda) for AI operations

**Database:**  
PostgreSQL (RDS)  
Tables: users, templates, documents, refinements, doc_chunks, doc_snapshots, doc_ops, user_prompts

**Infrastructure:**

- AWS S3 (uploads, exports, static hosting)
- AWS CloudFront (CDN)
- AWS API Gateway (HTTP + WebSocket APIs)
- AWS Lambda (Node + Python)
- AWS RDS (PostgreSQL in private subnets)
- AWS Secrets Manager (credential storage)
- AWS Bedrock (AI inference)

---

## 7. Success Criteria

- Upload → Generate → Refine → Export works flawlessly on deployed version.
- Real-time collaboration stable with 2+ users.
- Large files (50+ pages) processed via chunking/merge without failures.
- Error handling prevents crashes and duplicate operations.
- E2E test suite passes.
- S3 lifecycle rules functioning.
- Fully functional dashboard and routing between all major pages.

---

## 8. Deliverables

- Production-ready deployed app (AWS-hosted).
- Source code with modular structure:
  - `/apps/web/`
  - `/apps/api/`
  - `/apps/ai/`
  - `/scripts/`
- Database schema and migrations.
- Seeded sample data.
- Automated testing suite.
- Documentation for setup, deployment, and environment variables.
