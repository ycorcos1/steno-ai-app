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

#### Lambda Function

- **Function Name**: `stenoai-dev-api`
- **IAM Role**: `stenoai-dev-api-role`
- **Memory**: 256 MB
- **Timeout**: 30 seconds
- **VPC**: Attached to private VPC

#### API Gateway

- **API Name**: `stenoai-dev-api`
- **API ID**: `rtyj35z0ga`
- **Endpoint**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com`
- **Routes**: `/health`, `/health/db`, `/storage/*`

#### VPC & Networking

- **VPC ID**: `vpc-0b5ff75842342f527`
- **VPC Endpoints**:
  - S3 Gateway Endpoint (available)
  - Bedrock Runtime Interface Endpoint (available)
  - Secrets Manager Interface Endpoint (available)
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

### Health Check Endpoints

- **API Health**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health`
- **Database Health**: `https://rtyj35z0ga.execute-api.us-east-1.amazonaws.com/prod/health/db`

### Policy Files

- `/infra/iam/stenoai-deploy-policy.json` - IAM policy document
- `/infra/api/lambda-basic-policy.json` - Lambda basic permissions
- `/infra/api/lambda-vpc-policy.json` - Lambda VPC and Secrets Manager permissions

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

## Next Steps

Ready to proceed with:

- **PR #6**: DB Schema & Migrations
- **PR #7**: Auth Backend (JWT)
- All subsequent PRs

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
