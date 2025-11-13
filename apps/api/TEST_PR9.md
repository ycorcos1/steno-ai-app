# PR #9 Testing Guide - Ingest + Basic Extraction

## Overview

This document describes how to test the ingest functionality implemented in PR #9.

## Prerequisites

- API deployed to AWS (or running locally)
- Database connection configured
- S3 upload bucket exists and is accessible
- Test user account created
- AWS credentials configured

## Test Files Created

### 1. Unit Tests

Location: `src/lib/__tests__/extract_basic.test.ts`

- Tests extraction library logic (requires proper AWS SDK mocking)
- Run: `npm test`

### 2. Integration Tests

Location: `test/integration/ingest.test.ts`

- Tests full endpoint integration
- Requires deployed API and database
- Run: `npm test -- ingest.test.ts`

### 3. Manual Test Script

Location: `test/manual-test.sh`

- End-to-end manual testing script
- Tests complete upload → ingest flow
- Run: `bash test/manual-test.sh`

## Manual Testing Steps

### Step 1: Set Environment Variables

```bash
export API_BASE_URL="https://your-api.execute-api.region.amazonaws.com/prod"
export TEST_EMAIL="test@example.com"
export TEST_PASSWORD="password123"
```

### Step 2: Run Manual Test Script

```bash
cd apps/api
bash test/manual-test.sh
```

### Step 3: Verify Database

After successful ingestion, verify the document was created:

```sql
SELECT id, title, status, LENGTH(extracted_text) as text_length, created_at
FROM documents
WHERE owner_id = (SELECT id FROM users WHERE email = 'test@example.com')
ORDER BY created_at DESC
LIMIT 1;
```

Expected results:

- `status` = 'extracted'
- `extracted_text` is not null
- `text_length` > 0

## Test Cases

### ✅ Test Case 1: Authentication Required

**Endpoint**: `POST /documents/ingest`  
**Expected**: 401 Unauthorized when no auth token provided

```bash
curl -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -d '{"key":"test","originalName":"test.txt","mime":"text/plain","size":100}'
```

### ✅ Test Case 2: Input Validation

**Endpoint**: `POST /documents/ingest`  
**Expected**: 400 Bad Request when required fields missing

```bash
curl -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"key":"test"}'
```

### ✅ Test Case 3: Successful Text File Ingestion

**Steps**:

1. Get upload URL: `POST /documents/upload-url`
2. Upload file to S3 using presigned URL
3. Call ingest: `POST /documents/ingest`
4. Verify 201 response with documentId
5. Check database for document record

### ✅ Test Case 4: PDF File Ingestion

**Steps**:

1. Upload a PDF file (use a simple 1-page PDF)
2. Call ingest with `mime: "application/pdf"`
3. Verify extracted text contains expected content

### ✅ Test Case 5: DOCX File Ingestion

**Steps**:

1. Upload a DOCX file
2. Call ingest with `mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"`
3. Verify extracted text contains expected content

### ✅ Test Case 6: Unsupported File Type

**Endpoint**: `POST /documents/ingest`  
**Expected**: 422 Unprocessable Entity

```bash
curl -X POST "$API_BASE_URL/documents/ingest" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "key":"test.xyz",
    "originalName":"test.xyz",
    "mime":"application/unknown",
    "size":100
  }'
```

## Expected Behavior

### Successful Ingestion Response

```json
{
  "documentId": "uuid-here",
  "title": "test-document",
  "status": "extracted",
  "extractedLength": 1234,
  "createdAt": "2025-01-12T10:30:00.000Z"
}
```

### Error Responses

**401 Unauthorized**:

```json
{
  "error": "Authentication required"
}
```

**400 Bad Request**:

```json
{
  "error": "Missing required fields: key, originalName, mime, size"
}
```

**422 Unprocessable Entity**:

```json
{
  "error": "Failed to extract text from file",
  "message": "Unsupported file type: application/unknown"
}
```

## Troubleshooting

### Issue: "S3_UPLOAD_BUCKET not configured"

- **Solution**: Ensure environment variable is set in Lambda configuration

### Issue: "No file content received from S3"

- **Solution**: Verify file was successfully uploaded to S3 before calling ingest

### Issue: "Failed to extract text from file"

- **Solution**:
  - Verify file format is supported (PDF, DOCX, TXT)
  - Check file is not corrupted
  - Verify file was uploaded correctly to S3

### Issue: Database connection errors

- **Solution**:
  - Verify RDS is accessible from Lambda
  - Check security group rules
  - Verify database credentials in Secrets Manager

## Success Criteria

✅ All test cases pass  
✅ Documents created in database with `status='extracted'`  
✅ `extracted_text` field contains non-empty text  
✅ Authentication and validation work correctly  
✅ Error handling returns appropriate status codes  
✅ No errors in CloudWatch logs
