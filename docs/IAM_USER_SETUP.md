# StenoAI IAM User Setup

## Create IAM User: stenoai-app

You need to create this user manually in the AWS Console (or with an admin account) because the current `wordbridge-app` user doesn't have IAM permissions.

### Steps:

1. **Go to AWS Console → IAM → Users → Create User**
   - Username: `stenoai-app`
   - Access type: Programmatic access

2. **Attach Policy**: Use the policy from `/infra/iam/stenoai-deploy-policy.json`
   - Or attach: `PowerUserAccess` (for development)
   - Or create a custom policy with the permissions in `stenoai-deploy-policy.json`

3. **Create Access Key** and save:
   - Access Key ID
   - Secret Access Key

4. **Configure AWS CLI**:
   ```bash
   aws configure --profile stenoai
   # Enter the Access Key ID
   # Enter the Secret Access Key
   # Region: us-east-1
   # Output: json
   ```

5. **Set as default or use profile**:
   ```bash
   export AWS_PROFILE=stenoai
   # Or add to ~/.aws/credentials and set default
   ```

### Verify:
```bash
aws sts get-caller-identity --profile stenoai
# Should show: arn:aws:iam::971422717446:user/stenoai-app
```

## Current Resources Created

All resources created so far are properly tagged with `App=stenoai` and `Env=dev`:
- VPC: `stenoai-dev-vpc`
- RDS: `stenoai-dev-db`
- Lambda: `stenoai-dev-api`
- Security Groups: `stenoai-dev-sg-*`
- Secrets Manager: `/stenoai/dev/db`

**None of these affect your wordbridge-app project** - they are completely separate.

