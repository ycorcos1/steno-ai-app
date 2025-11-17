# AWS Configuration Summary

## ✅ Configuration Complete

Your AWS CLI is fully configured and StenoAI infrastructure is deployed.

### Current Configuration

- **AWS Account**: `971422717446`
- **IAM User**: `stenoai-app`
- **Region**: `us-east-1`
- **AWS CLI Profile**: `stenoai` (configured via `AWS_PROFILE=stenoai`)

### Attached IAM Policies

1. **PowerUserAccess** - AWS managed policy with broad access to most services
2. **StenoAIDeployAccess** - Customer managed policy for StenoAI deployment

### Deployed Resources (PRs 1-5 Complete)

#### S3 Buckets

- `stenoai-dev-web` - Static web hosting
- `stenoai-dev-uploads` - User file uploads
- `stenoai-dev-exports` - Document exports

**Lifecycle Management**: Run `bash scripts/s3_lifecycle.sh` to configure automatic cleanup:

- Uploads deleted after 30 days
- Exports deleted after 14 days
- Noncurrent versions transitioned to infrequent access storage

#### CloudFront Distribution

- **Distribution ID**: `E191Q6P4RJPH4D`
- **Domain**: `d2m2ob9ztbwghm.cloudfront.net`
- **Comment**: StenoAI Static Web Hosting

#### Lambda Functions

- **API Lambda**:
  - **Function Name**: `stenoai-dev-api`
  - **IAM Role**: `stenoai-dev-api-role`
  - **Memory**: 256 MB
  - **Timeout**: 30 seconds
  - **VPC**: Attached to private VPC
  - **Purpose**: Handles REST API routes (Express.js)

- **WebSocket Lambda**:
  - **Function Name**: `stenoai-dev-ws`
  - **IAM Role**: `stenoai-dev-ws-role`
  - **Memory**: 512 MB
  - **Timeout**: 30 seconds
  - **VPC**: Attached to private VPC
  - **Purpose**: Handles WebSocket connections for real-time collaboration
  - **Permissions**: DynamoDB access, API Gateway Management API access

#### API Gateway

- **HTTP API**:
  - **API Name**: `stenoai-dev-api`
  - **API ID**: `rtyj35z0ga`
  - **Endpoint**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com`
  - **Routes**: `/health`, `/health/db`, `/documents/*`, `/auth/*`, `/templates/*`, `/prompts/*`, `/exports/*`, etc.

- **WebSocket API**:
  - **API Name**: `stenoai-dev-ws`
  - **API ID**: `n3fxav2xid`
  - **Endpoint**: `wss://n3fxav2xid.execute-api.us-east-1.amazonaws.com/prod`
  - **Routes**: `$connect`, `$disconnect`, `$default`
  - **Purpose**: Real-time collaboration via WebSocket connections

#### VPC & Networking

- **VPC ID**: `vpc-0b5ff75842342f527`
- **VPC Endpoints**:
  - S3 Gateway Endpoint (available) — for uploads and exports
  - Bedrock Runtime Interface Endpoint (available) — for AI service access
  - Secrets Manager Interface Endpoint (available) — for secure credential access
  - DynamoDB Interface Endpoint (available) — for WebSocket connection state management
- **NAT Gateway**: Required for WebSocket Lambda to reach API Gateway Management API (for sending messages to clients)
- **Route Tables**: 
  - Public subnets route through Internet Gateway
  - Private subnets route through NAT Gateway for outbound internet access
- **Security Groups**: Configured for Lambda and RDS access

#### RDS Database

- **Instance**: `stenoai-dev-db`
- **Engine**: PostgreSQL 14.19
- **Endpoint**: `stenoai-dev-db.crws0amqe1e3.us-east-1.rds.amazonaws.com`
- **Port**: 5432
- **Status**: Available
- **Location**: Private subnet

#### Secrets Manager

- **Secret**: `/stenoai/dev/db`
- **Contains**: Database credentials (PGHOST, PGDATABASE, PGUSER, PGPASSWORD)

#### DynamoDB Tables

- **Table**: `stenoai-dev-connections`
  - **Purpose**: WebSocket connection tracking for real-time collaboration
  - **Partition Key**: `connectionId` (string)
  - **Global Secondary Indexes (GSI)**:
    - `userId-index`: Query connections by user ID (partition key: `userId`)
    - `documentId-index`: Query connections by document ID for room broadcasting (partition key: `documentId`)
  - **Attributes**:
    - `userId` (string) — User ID who owns this connection
    - `documentId` (string, nullable) — Document ID if joined to a room
    - `endpoint` (string) — API Gateway Management API endpoint URL
    - `connectedAt` (number) — Timestamp when connection was established
    - `lastActivityAt` (number) — Timestamp of last activity (ping/update)
    - `ttl` (number) — TTL timestamp for automatic expiration (1 hour)
  - **TTL**: Enabled on `ttl` attribute (1 hour expiration for automatic cleanup)
  - **Billing**: On-demand (pay per request)
  - **Access**: Lambda functions access via VPC Interface Endpoint for DynamoDB

**Why DynamoDB + RDS?**

- **RDS (PostgreSQL)**: Structured data (documents, templates, user accounts, Y.js snapshots/operations, document collaborators, invitations)
- **DynamoDB**: Real-time connection state (requires < 10ms latency, high write throughput, stateless Lambda support)
  - Low-latency reads/writes for WebSocket connection tracking
  - Automatic scaling with on-demand billing
  - TTL support for automatic cleanup of stale connections
  - Global Secondary Indexes for efficient room-based queries

**Setup**: Run `bash scripts/dynamodb_create.sh` to create the table and indexes

### Health Check Endpoints

- **API Health**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health`
- **Database Health**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health/db`

### Policy Files

- `/infra/iam/stenoai-deploy-policy.json` - IAM policy document (includes `dynamodb:*`)
- `/infra/api/lambda-basic-policy.json` - Lambda basic permissions
- `/infra/api/lambda-vpc-policy.json` - Lambda VPC and Secrets Manager permissions
- `/infra/api/lambda-dynamodb-policy.json` - Lambda DynamoDB access permissions

### Verification Scripts

Run these to check your setup:

```bash
# Check AWS permissions
bash scripts/verify_aws_permissions.sh

# Test API endpoints
curl https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health
curl https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health/db
```

## Completed PRs

- ✅ **PR #1**: Minimal Monorepo & Local Tooling
- ✅ **PR #2**: Static Hosting (S3 + CloudFront)
- ✅ **PR #3**: API Online (Lambda + API Gateway)
- ✅ **PR #4**: Public Upload/Download APIs (S3 Presigned URLs)
- ✅ **PR #5**: Network Hardening (VPC + RDS + VPC Endpoints + Secrets Manager)
- ✅ **PR #17**: Object Lifecycle Management (S3 lifecycle policies)
- ✅ **PR #21**: Real-Time Collaboration Infrastructure (WebSocket + DynamoDB)
- ✅ **PR #22**: Y.js CRDT Integration
- ✅ **PR #25**: User Presence System
- ✅ **PR #26**: Collaboration UI/UX
- ✅ **PR #27**: Invitation Database & API
- ✅ **PR #28**: Invitation UI Components

## Next Steps

Ready to proceed with:

- **PR #6**: DB Schema & Migrations
- **PR #7**: Auth Backend (JWT)
- All subsequent PRs (collaboration features are complete)

## DynamoDB Setup

DynamoDB is required for real-time collaboration. To set up:

1. **Create DynamoDB tables**:

   ```bash
   bash scripts/dynamodb_create.sh
   ```

2. **Attach DynamoDB permissions to Lambda role**:

   ```bash
   bash scripts/attach_dynamodb_policy.sh
   ```

3. **Update IAM user policy** (if not already updated):
   - The `StenoAIDeployAccess` policy should include `dynamodb:*`
   - Policy file: `/infra/iam/stenoai-deploy-policy.json`
   - Update in AWS Console or via CLI

## Notes

- All resources are tagged with `App=stenoai` and `Env=dev` for easy identification
- Resources are isolated from other projects (no wordbridge resources affected)
- Lambda is configured with VPC access for secure database connectivity
- Database credentials are stored securely in Secrets Manager
- All resources are in `us-east-1` region

## Troubleshooting

If you encounter issues:

1. **Check AWS credentials**: `export AWS_PROFILE=stenoai && aws sts get-caller-identity`
2. **Verify API health**: `curl https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health/db`
3. **Check Lambda logs**: `aws logs tail /aws/lambda/stenoai-dev-api --follow --region us-east-1`
4. **Verify RDS status**: `aws rds describe-db-instances --db-instance-identifier stenoai-dev-db --region us-east-1`
5. **Check VPC endpoints**: `aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=vpc-0b5ff75842342f527" --region us-east-1`
