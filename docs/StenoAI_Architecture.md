# StenoAI — System Architecture

> This document is the single source of truth for how StenoAI is wired in AWS, matching the approved PRD and task list. It specifies components, data flows, networking, security boundaries, storage schemas, and operational runbooks. Implementation is AWS‑CLI driven (no CI/CD required).

---

## 1) High‑Level View

```
+-------------------+            +--------------------+
|   Browser (Web)   |  HTTPS     |  CloudFront (CDN)  |
| React (Vite)      +----------->+  S3 Static Origin  |
+---------+---------+            +---------+----------+
          |                                |
          |  HTTPS (REST)                  |  Static assets
          v                                v
+---------+--------------------------------+
|         API Gateway - HTTP API           |
|   Routes: /health, /documents/*, ...     |
+----+-------------------------------------+
     | AWS_PROXY
     v
+----+------------------+        +----------------------+
|  Lambda (Node / API)  |        | Lambda (Python / AI) |
|  Express handlers      <------> | FastAPI: /generate   |
|  S3 presign, RDS, etc.|  VPC    | Bedrock invokeModel  |
+----+------------------+        +----------------------+
     |        |     |                         |
     |        |     |                         |
     |   +----v-+  +v-----+             +---- v ----+
     |   |  S3  |  |RDS   |             | Bedrock   |
     |   |(uploads, exports)            | (Claude)  |
     |   +------+  +------+             +-----------+
     |      ^
     |      | WebSocket (collab)
     v      |
+----+------v-------------------+
| API Gateway - WebSocket API   |
| Routes: $connect/$default/... |
+--------------------------------
```

**Key principles**

- Static site via **S3 + CloudFront**.
- Public REST via **API Gateway (HTTP)** proxying to **Node Lambda**.
- AI microservice via **Python Lambda** calling **Amazon Bedrock**.
- Real‑time collab via **API Gateway (WebSocket)** + Node Lambda relay.
- **RDS (PostgreSQL)** stores users, templates, documents, revisions, collab state.
- **S3** stores raw uploads and exports. Presigned URLs for client up/download.
- All compute in **private VPC** subnets with **VPC Endpoints** (S3, Bedrock, Secrets).
- Secrets in **AWS Secrets Manager**.

---

## 2) Components

### 2.1 Frontend (apps/web)

- React (Vite), Tailwind.
- Routes:
  - `/` Home, `/login`, `/signup`, `/dashboard`
  - `/upload`
  - `/documents/:id`, `/documents/:id/history`, `/documents/:id/collab`
  - `/templates`, `/templates/:id`
  - `/prompts`
  - `/exports`
  - `/testdata` (dev only)
- State: Context + Y.js (shared doc state for collab).

### 2.2 API Service (apps/api, Node/Express on Lambda)

- REST routes:
  - Health: `GET /health`, `GET /health/db`
  - Auth: `POST /auth/signup`, `POST /auth/login`
  - Storage: `POST /documents/upload-url`, `POST /documents/download-url`
  - Ingest: `POST /documents/ingest`
  - Documents: `GET /documents/:id`, `GET /documents/:id/revisions`
  - Templates: `GET /templates`, `GET /templates/:id`, `POST /templates`, `PUT /templates/:id`, `DELETE /templates/:id`
  - Drafting: `POST /documents/generate`
  - Refinement: `POST /ai/refine`
  - Export: `POST /documents/export/:id`, `GET /exports`
  - Prompts: `GET /prompts`, `GET /prompts/:id`, `POST /prompts`, `PUT /prompts/:id`, `DELETE /prompts/:id`
  - Test data: `POST /testdata/seed` (dev only)
- Shared libs: `composePrompt`, `extract_basic`, `extract_chunked`, `merge`, `retry`, `idempotency`.
- DB client: pg with connection pooling (pg-pool). Secrets pulled from Secrets Manager at cold start.

### 2.3 AI Service (apps/ai, Python/FastAPI on Lambda)

- Route: `POST /generate` — invokes Bedrock (Claude 3.5 Sonnet/Haiku) with composed prompt or chunked prompts.
- Response: plain text. Retries + timeouts enabled.

### 2.4 Realtime Collaboration (WebSocket)

- API Gateway (WebSocket) routes: `$connect`, `$disconnect`, `$default`.
- Node Lambda relay publishes ops between connected clients in a document room.
- **Connection Protocol:**
  - `$connect`: Client sends JWT in query param `?token=<jwt>`. Server validates and stores `connectionId → userId` mapping.
  - Join room: First message after connect: `{ "action": "join", "documentId": "uuid" }`. Server validates user access and adds to room.
  - Broadcast updates: `{ "action": "update", "documentId": "uuid", "update": "<base64-yjs-update>" }`. Relayed to all peers in room.
  - `$disconnect`: Cleanup connection mapping and notify room peers.
- Persistence layer:
  - `doc_snapshots` (periodic Y.js encoded state, every ~100 ops or 5 min).
  - `doc_ops` (append‑only op log with timestamps, session id).
- Reconnect flow: on `$connect` + join, server loads latest snapshot + plays ops since checkpoint.

---

## 3) AWS Infrastructure

### 3.1 Networking

- **VPC** with 2 private subnets (across AZs). Security groups:
  - `sg-lambda`: allows egress to VPC endpoints; ingress none.
  - `sg-rds`: allows ingress on 5432 from `sg-lambda` only.
- **VPC Endpoints (Interface):** `com.amazonaws.<region>.bedrock-runtime`, `secretsmanager`.
- **VPC Endpoint (Gateway):** S3.
- No NAT Gateway required.

### 3.2 Compute

- **Lambda/API (Node 20.x)** — attached to VPC private subnets.
- **Lambda/AI (Python 3.12)** — attached to same VPC.
- Memory/timeout tuned: API (256MB/15s), AI (1024MB/60s).

### 3.3 Storage & CDN

- **S3 buckets**
  - `stenoai-<env>-web` — static site origin for CloudFront.
  - `stenoai-<env>-uploads` — raw document uploads.
  - `stenoai-<env>-exports` — generated `.docx` outputs.
- **Lifecycle rules**
  - Uploads: delete after 30 days (unless referenced).
  - Exports: delete after 14 days.
  - Transition old versions to IA.
- **CloudFront** — origin access to web bucket; invalidation after deploy.

### 3.4 Database

- **RDS PostgreSQL** (db.t4g.micro for dev), in private subnets.
- Parameter group with UTF‑8; storage autoscaling on.
- **Connection Management**: Lambda uses `pg-pool` with `max: 2` connections per instance to avoid exhausting RDS connections. Consider RDS Proxy for production high-concurrency scenarios.

### 3.5 Secrets & Config

- **AWS Secrets Manager**
  - `/stenoai/<env>/db` — `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
  - `/stenoai/<env>/app` — `JWT_SECRET`, `API_BASE_URL`, `REGION`, etc.
- **Env Vars (Lambda)**
  - `ENV`, `REGION`, `APP`
  - `S3_UPLOAD_BUCKET`, `S3_EXPORT_BUCKET`
  - `BEDROCK_REGION`, `BEDROCK_MODEL_ID`

---

## 4) Security Model

- All data in transit via HTTPS (CloudFront ↔ Browser, Browser ↔ API GW).
- Private data paths stay inside VPC via endpoints (S3, Bedrock, Secrets).
- IAM policies:
  - API Lambda: `s3:GetObject/PutObject` on uploads/exports; `secretsmanager:GetSecretValue` on `/stenoai/*`.
  - AI Lambda: `bedrock:InvokeModel` on selected model; `secretsmanager:GetSecretValue`.
  - RDS access via SG allow‑list only.
- JWT auth on all private routes; presigned URLs scoped and expiring (≤15 min).

---

## 5) Data Model (RDS)

```
users(id pk, email unique, password_hash, created_at)
templates(id pk, title, content, is_global boolean default false, created_at, updated_at, owner_id fk users.id)
documents(id pk, owner_id fk, key, title, extracted_text, draft_text, status varchar, created_at, updated_at)
  -- status: 'uploaded' | 'extracted' | 'draft_generated' | 'exported'
refinements(id pk, document_id fk, prompt, result, created_at)
doc_chunks(id pk, document_id fk, idx, start, "end", summary)
doc_snapshots(id pk, document_id fk, version, snapshot_bytes, created_at)
doc_ops(id pk, document_id fk, op_bytes, created_at, session_id)
user_prompts(id pk, owner_id fk, name, body, created_at)
document_collaborators(id pk, document_id fk, user_id fk, role varchar, added_at)
  -- role: 'owner' | 'editor' | 'viewer'
exports(id pk, document_id fk, s3_key varchar, created_at, expires_at)
```

---

## 6) Critical Flows (Sequences)

### 6.1 Upload → Ingest

1. Web calls `POST /documents/upload-url` with `contentType`.
2. API returns presigned **PUT**, `key`, `bucket`.
3. Web `PUT`s file to S3.
4. Web calls `POST /documents/ingest` with `{ key, originalName, mime, size }`.
5. API extracts text (basic or chunked), creates `documents` (+ `doc_chunks` if applicable).

### 6.2 Generate Draft

1. Web calls `POST /documents/generate` with `{ documentId, templateId, instructions? }`.
2. API loads `extracted_text` (+ chunks) and template; composes prompt.
3. API calls AI service `/generate` → AI Lambda → Bedrock `invoke_model`.
4. On chunked docs: per‑chunk calls + merge; save `draft_text`.
5. Return `draft_text` to client.

### 6.3 Refine Draft

1. Web sends `POST /ai/refine` with `{ documentId, prompt }` (Idempotency-Key).
2. API composes refinement prompt with current draft; calls AI service.
3. Save `result` to `refinements`; update `documents.draft_text`.

### 6.4 Collaborative Edit

1. Clients connect to WebSocket `wss://<ws-id>.execute-api.<region>.amazonaws.com/prod?token=<jwt>`.
2. Server validates JWT on `$connect` and stores `connectionId → userId`.
3. Client sends join message: `{ "action": "join", "documentId": "<uuid>" }`.
4. Server checks `document_collaborators` table for access; if authorized, adds connection to room.
5. Server sends latest `doc_snapshot` + all `doc_ops` since that snapshot to sync client.
6. Editor uses Y.js; local ops broadcast via `$default` as `{ "action": "update", "documentId": "<uuid>", "update": "<base64>" }`.
7. Relay Lambda fans out to all peers in room.
8. Server persists ops to `doc_ops` and creates new snapshot every ~100 ops or 5 minutes.
9. On `$disconnect`, server removes connection from room and notifies peers (presence update).

### 6.5 Export

1. Web calls `POST /documents/export/:id`.
2. API renders `.docx` using `docx` library (plain text for MVP; template styling deferred).
3. API uploads to `exports/` bucket with key `exports/<documentId>-<timestamp>.docx`.
4. API saves metadata to `exports` table: `{ document_id, s3_key, created_at, expires_at }`.
5. API returns presigned GET URL (15 min expiry).
6. `/exports` page fetches `GET /exports` to list all user exports with download links.

---

## 7) Error Handling, Retries, Idempotency

- Shared `retry()` with exponential backoff for Bedrock/S3/DB (e.g., 100ms → 1.6s x 5).
- Idempotent POSTs using `Idempotency-Key` header and a request ledger to avoid double writes.
- Frontend ErrorBoundary + toast feedback; safe fallbacks for failed steps (e.g., retry upload, resumable ops on collab).

---

## 8) Scaling & Limits

- Lambda concurrency: API small (<= 50) by default; AI higher as needed.
- Bedrock rate‑limits: backoff; queue per document to limit parallel chunk calls.
- Large files: chunk at ~3–5k tokens; cap per document runtime; stream progress UI.
- WebSocket connections auto‑scale via API Gateway; relay Lambda remains stateless.

---

## 9) Cost Controls

- S3 lifecycle policies as specified (30d uploads, 14d exports, storage class transitions).
- VPC endpoints prevent NAT Gateway charges.
- Keep RDS small in dev; enforce idle timeouts on DB clients.

---

## 10) Local → AWS Deployment (Operator Runbook)

- **Migrations**: `bash scripts/migrate.sh` — applies all SQL files in `apps/api/migrations/` in order.
- **Web**: `npm --prefix apps/web run build && aws s3 sync apps/web/dist s3://stenoai-$ENV-web && aws cloudfront create-invalidation --distribution-id $CF_ID --paths "/*"`
- **API**: `npm --prefix apps/api run build && aws lambda update-function-code --function-name stenoai-$ENV-api --zip-file fileb://apps/api/dist/api.zip`
- **AI**: `pip install -r apps/ai/requirements.txt && zip -r ai.zip apps/ai && aws lambda update-function-code --function-name stenoai-$ENV-ai --zip-file fileb://ai.zip`

---

## 11) Configuration Matrix (Env Vars)

```
ENV=dev
REGION=us-east-1
APP=stenoai

S3_UPLOAD_BUCKET=stenoai-${ENV}-uploads
S3_EXPORT_BUCKET=stenoai-${ENV}-exports

BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0

API_BASE_URL=https://<api-id>.execute-api.${REGION}.amazonaws.com/prod
WS_BASE_URL=wss://<ws-id>.execute-api.${REGION}.amazonaws.com/prod
JWT_SECRET= (Secrets Manager)
PGHOST/PGDATABASE/PGUSER/PGPASSWORD= (Secrets Manager)

# Constants
CHUNK_TOKEN_LIMIT=4000
JWT_EXPIRY_HOURS=24
PRESIGNED_URL_EXPIRY_SECONDS=900
SNAPSHOT_INTERVAL_OPS=100
SNAPSHOT_INTERVAL_MINUTES=5
```

---

## 12) Open Questions (tracked)

- Do we need role‑based access (admin vs staff) now or later?
- DOCX styling fidelity (letterheads, margins) — covered by templates later if needed.
- SSO (Cognito/IdP) — out of scope for MVP; JWT custom for now.

---

## 13) Observability & Monitoring

- **CloudWatch Logs**: All Lambda functions log to `/aws/lambda/<function-name>`. Structured JSON logs with `requestId`, `userId`, `documentId` for traceability.
- **CloudWatch Alarms**:
  - Lambda errors > 5 in 5 minutes.
  - RDS CPU > 80%.
  - API Gateway 5xx errors > 10 in 5 minutes.
- **X-Ray Tracing**: Enabled on API Gateway + Lambda for request flow visualization.
- **Metrics Dashboard**: Custom dashboard tracking:
  - Document ingestion rate.
  - Bedrock invocation latency.
  - WebSocket active connections.
  - S3 upload/download volume.
