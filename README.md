# StenoAI — AI-Powered Legal Drafting Assistant

**An automated system that generates, refines, and exports professional demand letters based on firm-approved templates and user-uploaded documents using Amazon Bedrock AI models.**

---

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Introduction](#introduction)
- [Core Features](#core-features)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
- [Running Locally](#running-locally)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Future Developments](#future-developments)

---

## 🚀 Quick Start

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20.x+** (recommended: LTS version)
- **Python 3.12+**
- **PostgreSQL 14+** (client tools: `psql`)
- **AWS CLI** (v2.x recommended)
- **Git** for cloning the repository
- **jq** (for JSON parsing in scripts)
- **Make** (for build commands)

### Complete Setup Instructions

Follow these steps to get the project running:

#### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/steno-ai-app.git
cd steno-ai-app
```

#### 2. Install Dependencies

```bash
# Install root workspace dependencies
npm install

# Install frontend dependencies
npm --prefix apps/web install

# Install API dependencies
npm --prefix apps/api install

# Install AI service dependencies
cd apps/ai && pip install -r requirements.txt && cd ../..
```

#### 3. Configure Environment Variables

**For Local Development:**

Create a `.env` file in the root directory (optional for local dev, required for AWS):

```bash
# Environment Configuration
ENV=dev
REGION=us-east-1
APP=stenoai

# Database (for local development - use local PostgreSQL)
PGHOST=localhost
PGDATABASE=stenoai_dev
PGUSER=postgres
PGPASSWORD=your-local-password

# JWT Secret (generate with: openssl rand -hex 32)
JWT_SECRET=your-jwt-secret-here

# AWS Configuration (required for file uploads and AI service)
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# S3 Buckets (will be created during AWS setup)
S3_UPLOAD_BUCKET=stenoai-dev-uploads
S3_EXPORT_BUCKET=stenoai-dev-exports

# Bedrock Configuration
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0

# API Configuration (for frontend)
VITE_API_BASE_URL=http://localhost:3000
```

**For AWS Deployment:**

Environment variables are managed via AWS Secrets Manager and Lambda environment variables. See [AWS Setup](#aws-setup) section below.

#### 4. Set Up Local Database

**Option A: Local PostgreSQL (Recommended for Development)**

```bash
# Install PostgreSQL (macOS)
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb stenoai_dev

# Or using psql
psql postgres
CREATE DATABASE stenoai_dev;
\q
```

**Option B: Use AWS RDS (Production-like)**

Follow the AWS setup instructions below to create an RDS instance.

#### 5. Run Database Migrations

**For Local Database:**

```bash
# Set local database credentials
export PGHOST=localhost
export PGDATABASE=stenoai_dev
export PGUSER=postgres
export PGPASSWORD=your-password

# Run migrations manually
cd apps/api/migrations
for file in *.sql; do
  psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f "$file"
done
```

**For AWS RDS:**

```bash
# Source environment
source scripts/env.sh

# Run migration script (fetches credentials from Secrets Manager)
bash scripts/migrate.sh
```

#### 6. Start Development Servers

See [Running Locally](#running-locally) section for detailed instructions.

---

## Introduction

**StenoAI** is an AI-powered legal drafting assistant designed to help attorneys and legal staff generate, refine, and export professional demand letters based on firm-approved templates and user-uploaded documents. The platform uses Amazon Bedrock (Claude 3.5 Sonnet) to analyze documents and generate drafts, and provides a scalable, serverless architecture hosted entirely on AWS.

### What Problem Does It Solve?

Legal professionals face significant challenges:

- **Manual drafting is time-consuming** — Attorneys spend hours drafting demand letters from scratch
- **Inconsistent formatting** — Manual drafting often fails to maintain firm-wide template standards
- **Large file handling** — Processing complex, multi-page documents can be slow and unreliable

StenoAI addresses these issues by:

1. **Automating Draft Generation**: AI analyzes uploaded documents and generates drafts using firm-approved templates
2. **Template Management**: Centralized template system with personal and firm-wide templates
3. **Large File Support**: Intelligent chunking and merging for documents of any size
4. **Scalable Infrastructure**: Fully serverless AWS architecture that scales automatically

### Why Was It Built?

StenoAI was built to streamline the legal drafting process and reduce manual work. By automating the initial draft generation and providing powerful refinement tools, attorneys can focus on strategy and client relationships rather than repetitive writing tasks.

### Who Is It For?

**Primary Users:**

- **Attorneys / Legal Staff**: Upload client documents, generate AI-assisted drafts, refine them iteratively, and export polished demand letters
- **Law Firm Administrators**: Manage templates and control access permissions

---

## Core Features

### 1. **AI-Powered Draft Generation**

- **Automated Analysis**: Amazon Bedrock (Claude 3.5 Sonnet) analyzes uploaded documents to extract key information
- **Template-Based Generation**: Combines extracted text with firm-approved templates to generate professional drafts
- **Custom Instructions**: Optional prompt instructions for fine-tuning generation
- **Large File Handling**: Documents are intelligently chunked (~3-5k tokens) and merged for coherent output
- **Idempotent Operations**: Prevents duplicate generations via idempotency keys

### 2. **Document Upload & Ingestion**

- **Multiple Formats**: Supports `.docx`, `.pdf`, `.txt`, and `.csv` files
- **Presigned URLs**: Secure S3 uploads via presigned PUT URLs
- **Text Extraction**: Automatic text extraction from various file formats
- **Status Tracking**: Real-time upload status (pending → processing → completed/failed)
- **S3 Storage**: Files stored securely in AWS S3 with lifecycle management

### 3. **Template Management**

- **Personal Templates**: Users can create, edit, and delete their own templates
- **Firm-Wide Templates**: Global templates available to all users (admin feature)
- **Version Control**: Templates track creation and update timestamps
- **Template Selection**: Easy template picker in the editor interface

### 4. **AI Refinement**

- **Iterative Editing**: Submit natural language instructions to refine drafts
- **Version History**: All refinements stored with prompts and responses
- **Revision Tracking**: View and restore previous versions of drafts
- **Idempotent Refinements**: Prevents duplicate refinement operations

### 5. **Export Functionality**

- **DOCX Export**: Export drafts to `.docx` format using the `docx` library
- **Presigned Download URLs**: Secure, time-limited download links (15 min expiry)
- **Export History**: Track all exports with metadata and expiry dates
- **Auto-Cleanup**: Exports automatically deleted after 14 days via S3 lifecycle rules

### 6. **Custom Prompts**

- **Reusable Prompts**: Save and manage reusable prompt templates
- **Prompt Library**: Organize prompts for common refinement tasks
- **Quick Selection**: Select prompts directly in the editor interface

### 7. **Real-Time Collaboration**

- **Live Editing**: Multiple users can edit the same document simultaneously with real-time synchronization
- **Y.js CRDT**: Conflict-free replicated data type (CRDT) ensures all changes merge seamlessly
- **Presence System**: See who's currently viewing or editing the document with live user indicators
- **Typing Indicators**: Visual feedback when other users are actively typing
- **Connection Status**: Real-time connection status and latency monitoring
- **Invitation System**: Invite collaborators via secure token-based invitations with role-based access (owner, editor, viewer)
- **Access Control**: Granular permissions - owners can edit and share, editors can edit, viewers are read-only
- **Automatic Sync**: Changes sync automatically across all connected clients without page refresh
- **Offline Support**: Changes are queued and synced when connection is restored

### 8. **Authentication & Security**

- **JWT-Based Auth**: Secure authentication with httpOnly cookies
- **Password Hashing**: Bcrypt password hashing with salt rounds
- **Session Management**: 24-hour token expiry with automatic logout
- **Protected Routes**: All private endpoints require authentication

---

## Prerequisites

### Required Software

1. **Node.js 20.x+**

   ```bash
   # Check version
   node --version

   # Install via nvm (recommended)
   nvm install 20
   nvm use 20
   ```

2. **Python 3.12+**

   ```bash
   # Check version
   python3 --version

   # Install via Homebrew (macOS)
   brew install python@3.12
   ```

3. **PostgreSQL 14+**

   ```bash
   # Check version
   psql --version

   # Install via Homebrew (macOS)
   brew install postgresql@14
   brew services start postgresql@14
   ```

4. **AWS CLI v2.x**

   ```bash
   # Check version
   aws --version

   # Install via Homebrew (macOS)
   brew install awscli

   # Or download from: https://aws.amazon.com/cli/
   ```

5. **jq** (JSON processor)

   ```bash
   # Install via Homebrew (macOS)
   brew install jq
   ```

6. **Make** (Build tool)
   ```bash
   # Usually pre-installed on macOS/Linux
   make --version
   ```

### Required Environment Variables

#### Local Development

Create a `.env` file in the project root:

```bash
# Core Configuration
ENV=dev
REGION=us-east-1
APP=stenoai

# Database (Local PostgreSQL)
PGHOST=localhost
PGDATABASE=stenoai_dev
PGUSER=postgres
PGPASSWORD=your-local-password

# JWT Authentication
JWT_SECRET=your-jwt-secret-here  # Generate with: openssl rand -hex 32

# AWS Credentials (for S3 and Bedrock)
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# S3 Buckets
S3_UPLOAD_BUCKET=stenoai-dev-uploads
S3_EXPORT_BUCKET=stenoai-dev-exports

# Bedrock Configuration
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0

# Frontend Environment Variables (for Vite)
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_BASE_URL=ws://localhost:3001
```

#### AWS Deployment

Environment variables are configured via:

1. **AWS Secrets Manager** (for sensitive data):

   - `/stenoai/<env>/db` — Database credentials (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`)
   - `/stenoai/<env>/app` — Application secrets (`JWT_SECRET`, `API_BASE_URL`, etc.)

2. **Lambda Environment Variables** (for non-sensitive config):
   - `ENV`, `REGION`, `APP`
   - `S3_UPLOAD_BUCKET`, `S3_EXPORT_BUCKET`
   - `BEDROCK_REGION`, `BEDROCK_MODEL_ID`
   - `AI_FUNCTION_NAME` (for Lambda-to-Lambda invocation)

### AWS Setup and Configuration

#### 1. AWS Account Setup

1. **Create AWS Account** (if you don't have one)

   - Sign up at https://aws.amazon.com/
   - Note your AWS Account ID

2. **Create IAM User**

   Follow the instructions in [`docs/IAM_USER_SETUP.md`](./docs/IAM_USER_SETUP.md):

   ```bash
   # Create IAM user: stenoai-app
   # Attach policy from: infra/iam/stenoai-deploy-policy.json
   # Or use PowerUserAccess for development
   ```

3. **Configure AWS CLI**

   ```bash
   aws configure --profile stenoai
   # Enter Access Key ID
   # Enter Secret Access Key
   # Region: us-east-1
   # Output: json

   # Set as default
   export AWS_PROFILE=stenoai
   ```

4. **Verify AWS Configuration**

   ```bash
   aws sts get-caller-identity
   # Should show your IAM user ARN
   ```

#### 2. Create AWS Resources

**VPC and Networking:**

```bash
# Create VPC with private subnets
bash scripts/vpc_create.sh

# Create VPC endpoints (S3, Bedrock, Secrets Manager, DynamoDB)
bash scripts/vpc_endpoints.sh
```

**RDS Database:**

```bash
# Create RDS PostgreSQL instance
bash scripts/rds_create.sh

# This creates:
# - RDS instance in private subnet
# - Security group allowing Lambda access
# - Secrets Manager secret with credentials
```

**S3 Buckets:**

```bash
# Create S3 buckets for uploads and exports
bash scripts/data_buckets_create.sh

# Configure lifecycle policies
bash scripts/s3_lifecycle.sh
```

**DynamoDB Tables:**

```bash
# Create DynamoDB table for WebSocket connection tracking
bash scripts/dynamodb_create.sh

# Attach DynamoDB permissions to Lambda roles
bash scripts/attach_dynamodb_policy.sh
```

**Lambda Functions:**

```bash
# Build and deploy API Lambda
make api-zip
bash scripts/api_create.sh

# Build and deploy AI Lambda
make ai-zip
bash scripts/ai_create.sh
```

**API Gateway:**

```bash
# Create HTTP API Gateway
# (Usually done via api_create.sh script)
```

**WebSocket Infrastructure:**

```bash
# Build and deploy WebSocket Lambda
npm --prefix apps/api run build
bash scripts/ws_create.sh
```

**Note:** The WebSocket Lambda requires:

- DynamoDB table (`stenoai-<env>-connections`) for connection state (created above)
- DynamoDB VPC Interface Endpoint (created via `vpc_endpoints.sh`)
- NAT Gateway for API Gateway Management API access (created via `vpc_create.sh`)

**CloudFront Distribution:**

```bash
# Build frontend
make web-build

# Deploy to S3 and CloudFront
make web-deploy
# Or: bash scripts/web_create.sh
```

#### 3. Database Setup

**Note:** This section covers RDS (PostgreSQL) setup. For DynamoDB setup (required for real-time collaboration), see the "Create AWS Resources" section above.

**For AWS RDS:**

1. **Run Migrations:**

   ```bash
   # Source environment
   source scripts/env.sh

   # Run migrations (fetches credentials from Secrets Manager)
   bash scripts/migrate.sh
   ```

2. **Verify Database:**

   ```bash
   # Test connection via API health endpoint
   curl https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/health/db
   ```

**For Local PostgreSQL:**

1. **Create Database:**

   ```bash
   createdb stenoai_dev
   ```

2. **Run Migrations:**

   ```bash
   export PGHOST=localhost
   export PGDATABASE=stenoai_dev
   export PGUSER=postgres
   export PGPASSWORD=your-password

   cd apps/api/migrations
   for file in *.sql; do
     psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f "$file"
   done
   ```

3. **Verify Schema:**

   ```bash
   psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "\dt"
   # Should show: users, templates, documents, refinements, etc.
   ```

#### 4. Bedrock Model Access

1. **Request Model Access** (if not already granted):

   - Go to AWS Console → Amazon Bedrock → Model access
   - Request access to: `anthropic.claude-3-5-sonnet-20240620-v1:0`
   - Wait for approval (usually instant for Claude models)

2. **Verify Access:**

   ```bash
   aws bedrock list-foundation-models --region us-east-1 \
     --query 'modelSummaries[?contains(modelId, `claude-3-5-sonnet`)].modelId'
   ```

---

## Setup Instructions

### For Local Development

1. **Clone the repository** (see Quick Start above)

2. **Install dependencies:**

   ```bash
   npm install
   npm --prefix apps/web install
   npm --prefix apps/api install
   cd apps/ai && pip install -r requirements.txt && cd ../..
   ```

3. **Set up local PostgreSQL:**

   ```bash
   createdb stenoai_dev
   ```

4. **Configure environment variables:**

   - Create `.env` file (see Prerequisites section)
   - Or export variables in your shell

5. **Run database migrations:**

   ```bash
   # Set database credentials
   export PGHOST=localhost
   export PGDATABASE=stenoai_dev
   export PGUSER=postgres
   export PGPASSWORD=your-password

   # Run migrations
   cd apps/api/migrations
   for file in *.sql; do
     psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f "$file"
   done
   ```

6. **Start development servers** (see Running Locally section)

### For AWS Deployment

1. **Complete AWS Setup** (see Prerequisites → AWS Setup)

2. **Build all artifacts:**

   ```bash
   make all
   # Or individually:
   make web-build    # Frontend
   make api-zip      # API Lambda
   make ai-zip       # AI Lambda
   make ai-deps      # AI dependencies
   ```

3. **Deploy to AWS:**

   ```bash
   # Deploy frontend
   make web-deploy

   # Deploy API Lambda
   make api-deploy

   # Deploy AI Lambda
   make ai-deploy
   ```

4. **Run database migrations:**

   ```bash
   source scripts/env.sh
   bash scripts/migrate.sh
   ```

5. **Verify deployment:**

   ```bash
   # Check API health
   curl https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/health

   # Check database health
   curl https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/health/db
   ```

---

## Running Locally

### Start Development Servers

**Terminal 1: API Server**

```bash
cd apps/api
npm run dev
# Server runs on http://localhost:3000
```

**Terminal 2: Frontend Server**

```bash
cd apps/web
npm run dev
# Frontend runs on http://localhost:5173
```

**Terminal 3: AI Service (Optional - for local AI testing)**

```bash
cd apps/ai
# Install dependencies if not already done
pip install -r requirements.txt

# Run FastAPI server locally
uvicorn main:app --reload --port 8000
# Or using Python directly:
python -m uvicorn main:app --reload --port 8000
```

**Note:** For local development, the API will call the AI Lambda function in AWS by default. To use a local AI service, you'll need to modify the API configuration to point to `http://localhost:8000` instead of the Lambda function.

### Environment Variables for Local Development

Ensure these are set in your environment or `.env` file:

```bash
# API Server
export PGHOST=localhost
export PGDATABASE=stenoai_dev
export PGUSER=postgres
export PGPASSWORD=your-password
export JWT_SECRET=your-jwt-secret
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export S3_UPLOAD_BUCKET=stenoai-dev-uploads
export S3_EXPORT_BUCKET=stenoai-dev-exports
export BEDROCK_REGION=us-east-1
export BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0

# Frontend (Vite)
export VITE_API_BASE_URL=http://localhost:3000
```

### Access the Application

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **API Health Check**: http://localhost:3000/health
- **Database Health Check**: http://localhost:3000/health/db

### First Steps After Setup

1. **Create Account**: Navigate to http://localhost:5173/signup
2. **Log In**: Use your credentials at http://localhost:5173/login
3. **Create Template**: Go to Templates page and create your first template
4. **Upload Document**: Upload a document via the Upload page
5. **Generate Draft**: Select a template and generate your first AI draft
6. **Refine Draft**: Use the refinement feature to improve the draft
7. **Export**: Export your final draft as a DOCX file

---

## Project Structure

```
steno-ai-app/
├── apps/
│   ├── web/                 # React frontend (Vite)
│   │   ├── src/
│   │   │   ├── pages/       # Page components
│   │   │   ├── components/  # Reusable components
│   │   │   ├── lib/         # Utilities and auth
│   │   │   └── main.tsx     # Entry point
│   │   ├── dist/            # Build output
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── api/                 # Node.js API (Express on Lambda)
│   │   ├── src/
│   │   │   ├── routes/      # API route handlers
│   │   │   ├── middleware/  # Auth, errors, idempotency
│   │   │   ├── db/          # Database connection
│   │   │   ├── lib/         # Utilities (retry, merge, etc.)
│   │   │   └── index.ts     # Express app entry
│   │   ├── migrations/      # Database migrations
│   │   ├── dist/            # Build output
│   │   └── package.json
│   │
│   └── ai/                  # Python AI service (FastAPI on Lambda)
│       ├── main.py           # FastAPI app
│       ├── requirements.txt
│       └── scripts/
│           └── build.sh
│
├── infra/                    # Infrastructure as Code
│   ├── api/                  # Lambda IAM policies
│   ├── iam/                  # IAM policies
│   ├── s3/                   # S3 lifecycle configs
│   └── web/                  # CloudFront/S3 configs
│
├── scripts/                  # Deployment and utility scripts
│   ├── env.sh               # Environment configuration
│   ├── migrate.sh           # Database migrations
│   ├── api_create.sh        # Deploy API Lambda
│   ├── ai_create.sh         # Deploy AI Lambda
│   ├── web_create.sh        # Deploy frontend
│   ├── rds_create.sh        # Create RDS instance
│   ├── vpc_create.sh        # Create VPC
│   └── ...
│
├── docs/                     # Documentation
│   ├── StenoAI_PRD.md       # Product requirements
│   ├── StenoAI_Architecture.md
│   ├── AWS_SETUP.md
│   └── IAM_USER_SETUP.md
│
├── Makefile                  # Build commands
├── package.json              # Root workspace config
└── README.md                 # This file
```

### Key Directories

- **`apps/web/`**: React frontend built with Vite, uses TailwindCSS for styling
- **`apps/api/`**: Express.js API server that runs on AWS Lambda via serverless-http
- **`apps/ai/`**: FastAPI service that invokes Amazon Bedrock for AI generation
- **`apps/api/migrations/`**: SQL migration files applied in order
- **`scripts/`**: Bash scripts for AWS deployment and database management
- **`infra/`**: JSON configuration files for AWS resources (IAM policies, S3 lifecycle, etc.)

---

## API Documentation

### Base URL

- **Local Development**: `http://localhost:3000`
- **AWS Production**: `https://<api-id>.execute-api.<region>.amazonaws.com/prod`

### Authentication

Most endpoints require authentication via JWT token stored in an httpOnly cookie named `auth_token`. The token is obtained by logging in via `POST /auth/login`.

**Headers:**

- `Cookie: auth_token=<jwt-token>` (automatically handled by browser)
- `Content-Type: application/json`
- `Idempotency-Key: <uuid>` (required for POST requests to prevent duplicates)

### Endpoints

#### Health Checks

**GET /health**

- **Description**: Basic health check
- **Auth**: None
- **Response**: `{ "status": "ok" }`

**GET /health/db**

- **Description**: Database connection health check
- **Auth**: None
- **Response**: `{ "db": "ok", "connected": true }`

#### Authentication

**POST /auth/signup**

- **Description**: Create new user account
- **Auth**: None
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword123"
  }
  ```
- **Response**: `{ "message": "User created successfully" }`

**POST /auth/login**

- **Description**: Authenticate user and receive JWT token
- **Auth**: None
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword123"
  }
  ```
- **Response**: Sets httpOnly cookie with JWT token
- **Response Body**: `{ "message": "Login successful", "user": { "id": "...", "email": "..." } }`

**POST /auth/logout**

- **Description**: Log out user (clears cookie)
- **Auth**: Required
- **Response**: `{ "message": "Logged out successfully" }`

**GET /auth/me**

- **Description**: Get current user information
- **Auth**: Required
- **Response**: `{ "user": { "id": "...", "email": "..." } }`

#### Documents

**POST /documents/upload-url**

- **Description**: Get presigned URL for file upload
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "contentType": "application/pdf",
    "fileName": "document.pdf"
  }
  ```
- **Response**:
  ```json
  {
    "url": "https://s3.amazonaws.com/...",
    "key": "uploads/...",
    "bucket": "stenoai-dev-uploads"
  }
  ```

**POST /documents/ingest**

- **Description**: Process uploaded file and extract text
- **Auth**: Required
- **Idempotency**: Required
- **Request Body**:
  ```json
  {
    "key": "uploads/...",
    "originalName": "document.pdf",
    "mime": "application/pdf",
    "size": 12345
  }
  ```
- **Response**:
  ```json
  {
    "document": {
      "id": "...",
      "title": "document.pdf",
      "status": "extracted",
      "extractedText": "..."
    }
  }
  ```

**GET /documents**

- **Description**: List all user's documents
- **Auth**: Required
- **Response**:
  ```json
  {
    "documents": [
      {
        "id": "...",
        "title": "...",
        "status": "extracted",
        "createdAt": "..."
      }
    ]
  }
  ```

**GET /documents/:id**

- **Description**: Get document details
- **Auth**: Required
- **Response**:
  ```json
  {
    "document": {
      "id": "...",
      "title": "...",
      "extractedText": "...",
      "draftText": "...",
      "status": "..."
    }
  }
  ```

**PUT /documents/:id/draft**

- **Description**: Update draft text
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "draftText": "..."
  }
  ```

**DELETE /documents/:id**

- **Description**: Delete document
- **Auth**: Required

#### Draft Generation

**POST /documents/generate**

- **Description**: Generate AI draft from document and template
- **Auth**: Required
- **Idempotency**: Required
- **Request Body**:
  ```json
  {
    "documentId": "...",
    "templateId": "...",
    "instructions": "Optional custom instructions"
  }
  ```
- **Response**:
  ```json
  {
    "draftText": "...",
    "documentId": "..."
  }
  ```

#### Refinement

**POST /ai/refine**

- **Description**: Refine draft with AI based on prompt
- **Auth**: Required
- **Idempotency**: Required
- **Request Body**:
  ```json
  {
    "documentId": "...",
    "prompt": "Make the tone more formal"
  }
  ```
- **Response**:
  ```json
  {
    "refinedText": "...",
    "refinementId": "..."
  }
  ```

**GET /documents/:id/refinements**

- **Description**: Get refinement history for document
- **Auth**: Required
- **Response**:
  ```json
  {
    "refinements": [
      {
        "id": "...",
        "prompt": "...",
        "result": "...",
        "createdAt": "..."
      }
    ]
  }
  ```

#### Templates

**GET /templates**

- **Description**: List user's templates (personal + global)
- **Auth**: Required
- **Response**:
  ```json
  {
    "templates": [
      {
        "id": "...",
        "title": "...",
        "content": "...",
        "isGlobal": false,
        "createdAt": "..."
      }
    ]
  }
  ```

**GET /templates/:id**

- **Description**: Get template details
- **Auth**: Required

**POST /templates**

- **Description**: Create new template
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "title": "Demand Letter Template",
    "content": "Template content here..."
  }
  ```

**PUT /templates/:id**

- **Description**: Update template
- **Auth**: Required

**DELETE /templates/:id**

- **Description**: Delete template
- **Auth**: Required

#### Prompts

**GET /prompts**

- **Description**: List user's custom prompts
- **Auth**: Required

**GET /prompts/:id**

- **Description**: Get prompt details
- **Auth**: Required

**POST /prompts**

- **Description**: Create new prompt
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "name": "Formal Tone",
    "body": "Make the tone more formal and professional"
  }
  ```

**PUT /prompts/:id**

- **Description**: Update prompt
- **Auth**: Required

**DELETE /prompts/:id**

- **Description**: Delete prompt
- **Auth**: Required

#### Export

**POST /documents/export/:id**

- **Description**: Export document draft as DOCX
- **Auth**: Required
- **Idempotency**: Required
- **Response**:
  ```json
  {
    "exportId": "...",
    "downloadUrl": "https://s3.amazonaws.com/...",
    "expiresAt": "..."
  }
  ```

**GET /exports**

- **Description**: List user's exports
- **Auth**: Required
- **Response**:
  ```json
  {
    "exports": [
      {
        "id": "...",
        "documentId": "...",
        "downloadUrl": "...",
        "expiresAt": "..."
      }
    ]
  }
  ```

---

## Security Notes

### Authentication & Authorization

- **JWT Tokens**: All authentication uses JWT tokens with 24-hour expiry
- **HttpOnly Cookies**: Tokens stored in httpOnly cookies to prevent XSS attacks
- **Password Hashing**: Passwords hashed using bcrypt with 10 salt rounds
- **Token Validation**: All protected routes validate JWT tokens on every request

### Data Security

- **VPC Isolation**: All compute resources (Lambda, RDS) run in private VPC subnets
- **VPC Endpoints**: S3, Bedrock, and Secrets Manager accessed via VPC endpoints (no internet gateway)
- **Secrets Management**: Database credentials and JWT secrets stored in AWS Secrets Manager
- **Presigned URLs**: S3 uploads/downloads use time-limited presigned URLs (15 min expiry)
- **Encryption in Transit**: All API communication over HTTPS/TLS
- **Encryption at Rest**: RDS encryption enabled, S3 server-side encryption

### Network Security

- **Security Groups**: Strict security group rules:
  - Lambda security group: Egress only to VPC endpoints
  - RDS security group: Ingress only from Lambda security group on port 5432
- **No Public Access**: RDS and Lambda functions have no public IP addresses
- **Private Subnets**: All resources in private subnets with no direct internet access

### API Security

- **CORS**: Configured to allow only trusted origins (CloudFront domain, localhost for dev)
- **Idempotency**: POST endpoints use idempotency keys to prevent duplicate operations
- **Input Validation**: All user inputs validated and sanitized
- **Error Handling**: Generic error messages to prevent information leakage

### Best Practices

1. **Never commit secrets**: Use Secrets Manager or environment variables
2. **Rotate credentials**: Regularly rotate AWS access keys and database passwords
3. **Monitor access**: Enable CloudWatch logs and set up alarms for suspicious activity
4. **Least privilege**: IAM policies follow least privilege principle
5. **Regular updates**: Keep dependencies updated for security patches

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Problem**: API cannot connect to database

**Solutions**:

- **Local**: Verify PostgreSQL is running: `brew services list` or `pg_isready`
- **AWS**: Check RDS instance status: `aws rds describe-db-instances --db-instance-identifier stenoai-dev-db`
- **Credentials**: Verify database credentials in Secrets Manager or environment variables
- **Network**: Check security group rules allow Lambda to access RDS on port 5432
- **VPC**: Ensure Lambda is attached to the same VPC as RDS

**Debug**:

```bash
# Test local connection
psql -h localhost -U postgres -d stenoai_dev -c "SELECT 1;"

# Test AWS connection (from Lambda logs)
aws logs tail /aws/lambda/stenoai-dev-api --follow
```

#### 2. AWS Credentials Not Found

**Problem**: `Unable to locate credentials` error

**Solutions**:

- Set AWS profile: `export AWS_PROFILE=stenoai`
- Verify credentials: `aws sts get-caller-identity`
- Check `~/.aws/credentials` file exists and has correct keys
- For Lambda: Ensure IAM role has correct permissions

#### 3. Bedrock Access Denied

**Problem**: `AccessDeniedException` when calling Bedrock

**Solutions**:

- Request model access in AWS Console → Bedrock → Model access
- Verify IAM role has `bedrock:InvokeModel` permission
- Check model ID is correct: `anthropic.claude-3-5-sonnet-20240620-v1:0`
- Verify VPC endpoint for Bedrock is configured correctly

**Debug**:

```bash
# List available models
aws bedrock list-foundation-models --region us-east-1
```

#### 4. S3 Upload Fails

**Problem**: Presigned URL upload returns 403 Forbidden

**Solutions**:

- Check S3 bucket exists: `aws s3 ls | grep stenoai`
- Verify IAM permissions include `s3:PutObject` on upload bucket
- Check presigned URL hasn't expired (15 min limit)
- Verify bucket CORS configuration allows uploads

#### 5. Frontend Can't Connect to API

**Problem**: CORS errors or connection refused

**Solutions**:

- Verify `VITE_API_BASE_URL` is set correctly
- Check API server is running: `curl http://localhost:3000/health`
- For AWS: Verify API Gateway CORS configuration
- Check browser console for specific error messages

#### 6. Migration Errors

**Problem**: Database migrations fail

**Solutions**:

- Check migration files are in correct order (numbered: `0001_*.sql`, `0002_*.sql`, etc.)
- Verify database user has CREATE/ALTER permissions
- Check for syntax errors in SQL files
- Review `schema_migrations` table to see which migrations have been applied

**Debug**:

```bash
# Check applied migrations
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT * FROM schema_migrations;"
```

#### 7. Lambda Timeout Errors

**Problem**: Lambda function times out (especially AI service)

**Solutions**:

- Increase Lambda timeout (AI service may need 60-120 seconds)
- Check CloudWatch logs for specific errors
- Verify VPC endpoint connectivity (no NAT Gateway needed)
- For large documents: Ensure chunking is working correctly

**Debug**:

```bash
# Check Lambda configuration
aws lambda get-function-configuration --function-name stenoai-dev-ai

# View logs
aws logs tail /aws/lambda/stenoai-dev-ai --follow
```

#### 8. Build Errors

**Problem**: `npm install` or `make` commands fail

**Solutions**:

- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 20.x+)
- Verify Python version: `python3 --version` (should be 3.12+)
- For TypeScript errors: Run `npm run build` in `apps/api` to see detailed errors

#### 9. Environment Variable Issues

**Problem**: Application can't find required environment variables

**Solutions**:

- Verify `.env` file exists in project root (for local dev)
- Check variable names are correct (case-sensitive)
- For Vite: Variables must start with `VITE_` to be exposed to frontend
- For AWS: Verify Secrets Manager secrets exist and Lambda has access
- Use `echo $VARIABLE_NAME` to verify variables are set

### Getting Help

1. **Check Logs**:

   - Local API: Check terminal output
   - AWS Lambda: `aws logs tail /aws/lambda/<function-name> --follow`
   - Frontend: Check browser console and Network tab

2. **Verify Configuration**:

   - Run `bash scripts/verify_all.sh` (if available)
   - Check AWS resources: `aws sts get-caller-identity`

3. **Review Documentation**:

   - [`docs/StenoAI_Architecture.md`](./docs/StenoAI_Architecture.md)
   - [`docs/AWS_SETUP.md`](./docs/AWS_SETUP.md)
   - [`docs/IAM_USER_SETUP.md`](./docs/IAM_USER_SETUP.md)

4. **Test Endpoints**:

   ```bash
   # Health check
   curl http://localhost:3000/health

   # Database health
   curl http://localhost:3000/health/db
   ```

---

## Future Developments

### Enhanced Collaboration Features

The following enhancements are planned for real-time collaboration:

- **Advanced Presence System**:

  - Real-time cursor positions and selections
  - User avatars and names displayed in the editor
  - Visual indicators for active editors

- **Collaboration Enhancements**:

  - Comments and annotations on specific document sections
  - @mentions to notify collaborators
  - Activity log showing who made what changes
  - Email notifications for invitations (currently in-app only)

- **Conflict Resolution**:

  - Visual diff viewer for conflicting changes
  - Manual merge tools for resolving conflicts
  - Automatic conflict detection and warnings
  - Version branching for experimental edits

- **Performance Optimizations**:
  - Bandwidth optimization for slow connections
  - Enhanced offline editing support with improved sync on reconnect
  - Further latency optimizations for real-time updates

---

## Documentation

### Core Documentation

- **[Product Requirements Document](./docs/StenoAI_PRD.md)**: Complete product specifications
- **[Architecture Documentation](./docs/StenoAI_Architecture.md)**: System architecture and data flow
- **[AWS Setup Guide](./docs/AWS_SETUP.md)**: Detailed AWS configuration instructions
- **[IAM User Setup](./docs/IAM_USER_SETUP.md)**: IAM user creation and configuration

### Additional Resources

- **API Endpoints**: See [API Documentation](#api-documentation) section above
- **Database Schema**: See `apps/api/migrations/` for SQL schema definitions
- **Testing**: Test suites in `apps/api/test/` and `apps/web/e2e/`

---

## License

[Add your license here]

---

## Support

For questions or issues:

- Check the [Troubleshooting](#troubleshooting) section above
- Review [Architecture Documentation](./docs/StenoAI_Architecture.md) for system understanding
- See [Product Requirements Document](./docs/StenoAI_PRD.md) for feature specifications
- Check [AWS Setup Guide](./docs/AWS_SETUP.md) for deployment help

---

**Last Updated**: January 2025  
**Version**: 1.0  
**Status**: Production Ready
