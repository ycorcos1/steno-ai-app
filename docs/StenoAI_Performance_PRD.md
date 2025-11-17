# StenoAI — Performance Optimization PRD

## 1. Overview

**Project Name:** StenoAI Performance Optimization  
**Goal:** Dramatically improve the speed of demand letter generation and refinement operations through parallel processing, caching, infrastructure optimization, and intelligent batching.

This PRD focuses on reducing AI generation and refinement latency from 50+ seconds to under 10 seconds for large documents, and from 8-10 seconds to 3-5 seconds for single documents. The optimizations will leverage parallel processing, intelligent caching, infrastructure tuning, and progressive response streaming.

---

## 2. Target Users

1. **All StenoAI Users** – Benefit from faster generation and refinement
2. **Power Users** – Process multiple documents quickly
3. **Legal Teams** – Reduce wait times during high-volume periods
4. **Mobile Users** – Faster operations on slower connections

---

## 3. Objectives

- **Reduce generation time by 5-10x** for large documents (50s → 5-10s)
- **Reduce generation time by 2x** for single documents (8-10s → 3-5s)
- **Reduce refinement time by 2x** (8-10s → 3-5s)
- **Improve perceived performance** with progressive feedback
- **Optimize infrastructure costs** while improving speed
- **Maintain reliability** and error handling

---

## 4. Current Performance Analysis

### 4.1 Bottlenecks Identified

#### 4.1.1 Sequential Chunk Processing ⚠️ **CRITICAL**

**Current Implementation:**

- Chunks processed in `for` loop (sequential)
- Each chunk waits for previous to complete
- 10 chunks × 5-8 seconds = **50-80 seconds total**

**Impact:**

- Large documents take 50-150 seconds
- Poor user experience (long wait times)
- No progress feedback

**Solution:**

- Process all chunks in parallel using `Promise.all()`
- Expected improvement: **5-10x faster** (50s → 5-10s)

#### 4.1.2 No Caching ⚠️ **HIGH PRIORITY**

**Current Implementation:**

- Templates fetched from DB on every request
- Prompts recomposed every time
- No memoization of common operations

**Impact:**

- 100-200ms wasted per request
- Database load for repeated queries
- Slower response times

**Solution:**

- In-memory template cache (5-minute TTL)
- Prompt composition memoization
- Database query result caching

#### 4.1.3 Lambda Configuration ⚠️ **MEDIUM PRIORITY**

**Current Implementation:**

- AI Lambda: 256MB memory (low CPU allocation)
- API Lambda: 256MB memory
- No provisioned concurrency

**Impact:**

- Slower execution due to low CPU
- Cold start delays
- Inconsistent performance

**Solution:**

- Increase AI Lambda to 1024MB or 2048MB
- Test optimal memory allocation
- Consider provisioned concurrency for AI Lambda

#### 4.1.4 Database Query Optimization ⚠️ **MEDIUM PRIORITY**

**Current Implementation:**

- No indexes on frequently queried columns
- Sequential queries for document + template
- No query result caching

**Impact:**

- 50-100ms per query
- Database load under high concurrency
- Slower dashboard loads

**Solution:**

- Add indexes on `documents.owner_id`, `templates.owner_id`
- Optimize document fetching queries
- Consider read replicas for heavy load

#### 4.1.5 No Streaming/Progressive Response ⚠️ **HIGH PRIORITY**

**Current Implementation:**

- Users wait for entire generation to complete
- No partial results shown
- Poor perceived performance

**Impact:**

- Users see no feedback for 50+ seconds
- Perceived as "slow" even if backend is fast
- No way to cancel long operations

**Solution:**

- Stream results via WebSocket (see Collaboration PRD)
- Show partial results as chunks complete
- Progress indicators and cancel functionality

---

## 5. Functional Requirements

### 5.1 Parallel Chunk Processing

#### 5.1.1 Implementation

- **Replace Sequential Loop with Parallel Processing**

  - Use `Promise.all()` to process all chunks simultaneously
  - Maintain chunk ordering in results
  - Handle errors gracefully (one chunk failure doesn't stop others)

- **Concurrency Control**

  - Configurable concurrency limit (default: 10 chunks in parallel)
  - Rate limiting to avoid Bedrock throttling
  - Smart batching for very large documents (50+ chunks)

- **Error Handling**
  - Retry failed chunks individually
  - Continue processing successful chunks
  - Merge partial results if some chunks fail
  - Clear error messages for users

#### 5.1.2 Expected Performance

- **10-chunk document**: 50-80s → **8-12s** (5-7x faster)
- **5-chunk document**: 25-40s → **5-8s** (5x faster)
- **Single document**: 8-10s → **3-5s** (2x faster)

### 5.2 Intelligent Caching

#### 5.2.1 Template Caching

- **In-Memory Cache**

  - Cache templates by ID with 5-minute TTL
  - Cache invalidation on template update
  - Per-Lambda-instance cache (simple Map)
  - Fallback to database on cache miss

- **Cache Strategy**

  ```typescript
  interface TemplateCache {
    [templateId: string]: {
      content: string;
      timestamp: number;
      ttl: number; // 5 minutes
    };
  }
  ```

- **Cache Invalidation**
  - Invalidate on template update/delete
  - TTL-based expiration
  - Manual cache clear endpoint (admin)

#### 5.2.2 Prompt Composition Memoization

- **Memoize Common Prompts**
  - Cache composed prompts by (documentHash, templateId, instructions)
  - Useful for repeated generations
  - Short TTL (1-2 minutes) due to document changes

#### 5.2.3 Database Query Caching

- **Query Result Cache**
  - Cache frequently accessed documents
  - Cache template lists per user
  - TTL: 30 seconds to 2 minutes
  - Invalidate on updates

### 5.3 Infrastructure Optimization

#### 5.3.1 Lambda Memory Tuning

- **AI Lambda Optimization**

  - Test memory sizes: 512MB, 1024MB, 2048MB
  - Measure execution time vs. cost
  - Optimal: Balance speed and cost
  - Expected: 20-30% faster with more memory

- **API Lambda Optimization**
  - Increase to 512MB for better CPU allocation
  - Test concurrent request handling
  - Optimize cold start times

#### 5.3.2 Provisioned Concurrency

- **AI Lambda Provisioned Concurrency**
  - Keep 2-5 warm instances
  - Eliminate cold starts for AI operations
  - Cost vs. performance trade-off
  - Monitor usage patterns

#### 5.3.3 Connection Pooling

- **Database Connection Pool**
  - Already using `pg-pool` with `max: 2`
  - Consider increasing to `max: 5` for high concurrency
  - Monitor connection usage
  - Consider RDS Proxy for production (post-MVP)

#### 5.3.4 VPC Endpoint Optimization

- **Verify VPC Endpoint Performance**
  - Ensure Bedrock endpoint is optimal
  - Monitor endpoint latency
  - Consider multiple endpoints for redundancy

### 5.4 Database Performance

#### 5.4.1 Index Optimization

**New Indexes:**

```sql
-- Documents table
CREATE INDEX idx_documents_owner_id ON documents(owner_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_updated_at ON documents(updated_at DESC);

-- Templates table
CREATE INDEX idx_templates_owner_id ON templates(owner_id);
CREATE INDEX idx_templates_is_global ON templates(is_global) WHERE is_global = true;
CREATE INDEX idx_templates_last_used_at ON templates(last_used_at DESC);

-- Refinements table
CREATE INDEX idx_refinements_document_id_created_at ON refinements(document_id, created_at DESC);

-- Doc chunks table
CREATE INDEX idx_doc_chunks_document_id_idx ON doc_chunks(document_id, idx);
```

#### 5.4.2 Query Optimization

- **Optimize Document Fetching**

  - Use `SELECT` only needed columns
  - Avoid N+1 queries
  - Batch related queries

- **Optimize Template Queries**
  - Cache template lists per user
  - Use indexes effectively
  - Limit result sets

#### 5.4.3 Read Replicas (Post-MVP)

- Consider RDS read replicas for:
  - Dashboard queries
  - Document listing
  - Template listing
  - Read-heavy operations

### 5.5 Progressive Response Streaming

#### 5.5.1 WebSocket-Based Streaming

- **Integration with Collaboration PRD**

  - Leverage WebSocket infrastructure
  - Send progress events as chunks complete
  - Stream partial results to UI

- **Progress Events**
  ```typescript
  {
    type: "generation_progress",
    documentId: string,
    progress: {
      chunkIndex: number,
      totalChunks: number,
      status: "processing" | "complete" | "error",
      partialText: string, // Accumulated text
      chunkText: string, // This chunk's text
      elapsedTime: number,
      estimatedTimeRemaining: number
    }
  }
  ```

#### 5.5.2 UI Progress Indicators

- **Progress Bar**

  - Visual progress bar (0-100%)
  - Chunk-by-chunk status
  - Time estimates

- **Partial Results Display**

  - Show draft text as chunks complete
  - Highlight newly added sections
  - Smooth scrolling to new content

- **Cancel Functionality**
  - Cancel button during generation
  - Graceful cancellation
  - Cleanup of in-progress operations

### 5.6 Frontend Performance

#### 5.6.1 Code Splitting

- **Route-Based Splitting**

  - Lazy load Editor, Templates, Prompts pages
  - Reduce initial bundle size
  - Faster page loads

- **Component Splitting**
  - Lazy load heavy components
  - Dynamic imports for Y.js
  - Optimize bundle size

#### 5.6.2 Optimistic UI Updates

- **Immediate Feedback**
  - Show loading states immediately
  - Optimistic updates for quick operations
  - Rollback on error

#### 5.6.3 Background Pre-fetching

- **Pre-fetch Resources**
  - Pre-fetch templates on dashboard load
  - Pre-fetch document metadata
  - Cache API responses in browser

---

## 6. Technical Implementation

### 6.1 Parallel Chunk Processing

#### 6.1.1 Code Changes

**File: `apps/api/src/routes/generate.ts`**

Replace sequential loop (lines 112-203) with:

```typescript
// Process all chunks in parallel
const chunkPromises = chunks.map(async (chunk, index) => {
  try {
    const chunkText = extractedText.substring(
      chunk.start as number,
      chunk.end as number
    );

    const chunkPrompt = composePrompt(chunkText, templateContent, instructions);

    // Call AI Lambda with retry
    const aiResponse = await retry(
      async () => {
        // ... existing Lambda invocation code ...
      },
      { maxAttempts: 5, initialDelayMs: 100 }
    );

    // Send progress event via WebSocket (if connected)
    if (req.wsConnectionId) {
      await sendProgressEvent(req.wsConnectionId, {
        chunkIndex: index,
        totalChunks: chunks.length,
        status: "complete",
        chunkText: aiResponse.data.text || "",
      });
    }

    return {
      idx: chunk.idx as number,
      text: aiResponse.data.text || "",
    };
  } catch (error) {
    console.error(`Chunk ${chunk.idx} failed:`, error);
    // Return empty text for failed chunk (will be handled in merge)
    return {
      idx: chunk.idx as number,
      text: "",
      error: error.message,
    };
  }
});

// Wait for all chunks to complete (parallel execution)
const chunkResults = await Promise.all(chunkPromises);

// Filter out failed chunks and merge successful ones
const successfulChunks = chunkResults.filter((c) => !c.error);
if (successfulChunks.length === 0) {
  throw new Error("All chunks failed to process");
}

draftText = mergeChunks(successfulChunks);
```

#### 6.1.2 Concurrency Control

```typescript
// Limit concurrent chunks to avoid Bedrock throttling
const CONCURRENT_CHUNKS_LIMIT = 10;

async function processChunksInBatches(
  chunks: Chunk[],
  batchSize: number = CONCURRENT_CHUNKS_LIMIT
): Promise<ChunkResult[]> {
  const results: ChunkResult[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((chunk) => processChunk(chunk))
    );
    results.push(...batchResults);
  }

  return results;
}
```

### 6.2 Template Caching

#### 6.2.1 Cache Implementation

**File: `apps/api/src/lib/templateCache.ts`** (new file)

```typescript
interface CachedTemplate {
  content: string;
  timestamp: number;
  ttl: number;
}

class TemplateCache {
  private cache = new Map<string, CachedTemplate>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  async get(templateId: string): Promise<string | null> {
    const cached = this.cache.get(templateId);

    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.content;
    }

    // Cache miss or expired
    this.cache.delete(templateId);
    return null;
  }

  set(templateId: string, content: string, ttl?: number): void {
    this.cache.set(templateId, {
      content,
      timestamp: Date.now(),
      ttl: ttl || this.DEFAULT_TTL,
    });
  }

  invalidate(templateId: string): void {
    this.cache.delete(templateId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const templateCache = new TemplateCache();
```

#### 6.2.2 Integration in generate.ts

```typescript
// Check cache first
let templateContent = await templateCache.get(templateId);

if (!templateContent) {
  // Fetch from database
  const templateResult = await query(/* ... */);
  templateContent = template.content || "";

  // Cache for future use
  templateCache.set(templateId, templateContent);
}
```

### 6.3 Lambda Memory Optimization

#### 6.3.1 Update Script

**File: `scripts/optimize_lambda.sh`** (new file)

```bash
#!/bin/bash
source scripts/env.sh

# Update AI Lambda memory
aws lambda update-function-configuration \
  --function-name stenoai-${ENV}-ai \
  --memory-size 1024 \
  --region ${REGION}

# Update API Lambda memory
aws lambda update-function-configuration \
  --function-name stenoai-${ENV}-api \
  --memory-size 512 \
  --region ${REGION}

echo "Lambda memory optimization complete"
```

### 6.4 Database Indexes

#### 6.4.1 Migration File

**File: `apps/api/migrations/0007_performance_indexes.sql`** (new file)

```sql
-- Performance indexes for faster queries

-- Documents table indexes
CREATE INDEX IF NOT EXISTS idx_documents_owner_id
  ON documents(owner_id);

CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_updated_at
  ON documents(updated_at DESC);

-- Templates table indexes
CREATE INDEX IF NOT EXISTS idx_templates_owner_id
  ON templates(owner_id);

CREATE INDEX IF NOT EXISTS idx_templates_is_global
  ON templates(is_global)
  WHERE is_global = true;

CREATE INDEX IF NOT EXISTS idx_templates_last_used_at
  ON templates(last_used_at DESC NULLS LAST);

-- Refinements table indexes
CREATE INDEX IF NOT EXISTS idx_refinements_document_id_created_at
  ON refinements(document_id, created_at DESC);

-- Doc chunks table indexes
CREATE INDEX IF NOT EXISTS idx_doc_chunks_document_id_idx
  ON doc_chunks(document_id, idx);

-- Document collaborators index (for collaboration)
CREATE INDEX IF NOT EXISTS idx_document_collaborators_document_user
  ON document_collaborators(document_id, user_id);
```

---

## 7. Implementation Phases

### Phase 1: Quick Wins (Week 1)

**PR #27: Parallel Chunk Processing**

- Replace sequential loop with `Promise.all()`
- Add concurrency control
- Error handling for failed chunks
- Progress events (basic)

**Deliverables:**

- Updated `generate.ts` with parallel processing
- 5-10x speed improvement for large documents
- Error handling and retry logic

**PR #28: Template Caching**

- Implement in-memory template cache
- Cache invalidation on updates
- Integration in generate and refine routes

**Deliverables:**

- `templateCache.ts` module
- Cache integration in routes
- 100-200ms saved per request

**PR #29: Lambda Memory Optimization**

- Increase AI Lambda to 1024MB
- Increase API Lambda to 512MB
- Performance testing and validation

**Deliverables:**

- Updated Lambda configurations
- Performance benchmarks
- Cost analysis

### Phase 2: Database & Infrastructure (Week 2)

**PR #30: Database Index Optimization**

- Add performance indexes
- Optimize query patterns
- Migration script

**Deliverables:**

- Migration file with indexes
- Query performance improvements
- Dashboard load time < 1s

**PR #31: Query Optimization**

- Optimize document fetching queries
- Batch related queries
- Reduce N+1 query patterns

**Deliverables:**

- Optimized query functions
- Reduced database load
- Faster API responses

### Phase 3: Progressive Response (Week 2-3)

**PR #32: Progressive Generation UI**

- Integrate with Collaboration PRD WebSocket
- Progress bar component
- Partial results display
- Cancel functionality

**Deliverables:**

- Progress UI components
- WebSocket integration
- Cancel generation feature
- Improved perceived performance

**PR #33: Frontend Performance**

- Code splitting and lazy loading
- Optimistic UI updates
- Background pre-fetching

**Deliverables:**

- Reduced bundle size
- Faster page loads
- Better user experience

---

## 8. Success Criteria

### 8.1 Performance Targets

#### Generation Speed

- **10-chunk document**: 50-80s → **8-12s** (5-7x faster) ✅
- **5-chunk document**: 25-40s → **5-8s** (5x faster) ✅
- **Single document**: 8-10s → **3-5s** (2x faster) ✅
- **First result visible**: < 3 seconds ✅

#### Refinement Speed

- **Refinement time**: 8-10s → **3-5s** (2x faster) ✅
- **Progress feedback**: Immediate ✅

#### Database Performance

- **Template fetch**: < 50ms (cached) ✅
- **Document fetch**: < 100ms ✅
- **Dashboard load**: < 1s ✅

### 8.2 Reliability Targets

- **Error rate**: < 1% for generation operations ✅
- **Partial failure handling**: Graceful degradation ✅
- **Cache hit rate**: > 80% for templates ✅

### 8.3 User Experience Targets

- **Perceived performance**: Users see results within 3-5s ✅
- **Progress visibility**: Clear progress indicators ✅
- **Cancel functionality**: Working cancel button ✅

---

## 9. Monitoring & Metrics

### 9.1 Key Metrics

#### Generation Performance

- Average generation time (by chunk count)
- P50, P95, P99 latencies
- Chunk processing time distribution
- Parallel vs. sequential comparison

#### Cache Performance

- Template cache hit rate
- Cache size and memory usage
- Cache invalidation frequency

#### Infrastructure Performance

- Lambda execution time (before/after)
- Lambda memory utilization
- Database query time
- Connection pool usage

### 9.2 CloudWatch Dashboards

- **Generation Performance Dashboard**

  - Average generation time
  - Chunk processing times
  - Error rates
  - Throughput

- **Cache Performance Dashboard**

  - Cache hit rates
  - Cache size
  - Invalidation events

- **Infrastructure Dashboard**
  - Lambda metrics
  - Database performance
  - API Gateway latency

### 9.3 Alerts

- Generation time > 15s (p95)
- Cache hit rate < 70%
- Lambda errors > 5 in 5 minutes
- Database query time > 500ms

---

## 10. Cost Analysis

### 10.1 Cost Increases

- **Lambda Memory**: ~2x cost for AI Lambda (256MB → 1024MB)
- **Provisioned Concurrency**: Additional cost for warm instances
- **DynamoDB**: Connection tracking tables (minimal)

### 10.2 Cost Savings

- **Reduced Lambda Duration**: Faster execution = less compute time
- **Cache Hits**: Fewer database queries
- **Efficient Processing**: Parallel processing uses same total compute

### 10.3 Expected Net Impact

- **Slight increase** (~10-20%) in Lambda costs
- **Significant improvement** in user experience
- **Better cost per request** (faster = more requests per hour)

---

## 11. Testing Requirements

### 11.1 Performance Tests

- **Load Testing**

  - 10 concurrent generations
  - 50 concurrent generations
  - Measure response times

- **Stress Testing**

  - 100-chunk document
  - Multiple large documents simultaneously
  - Database under load

- **Benchmarking**
  - Before/after comparisons
  - Chunk processing times
  - Cache effectiveness

### 11.2 Integration Tests

- Parallel chunk processing
- Cache invalidation
- Error handling
- Progress events

### 11.3 E2E Tests

- Full generation flow
- Refinement flow
- Progress indicators
- Cancel functionality

---

## 12. Rollout Plan

### 12.1 Phase 1: Quick Wins (Week 1)

- Deploy parallel processing
- Deploy template caching
- Deploy Lambda optimization
- Monitor performance improvements

### 12.2 Phase 2: Database & Infrastructure (Week 2)

- Deploy database indexes
- Optimize queries
- Monitor query performance

### 12.3 Phase 3: Progressive Response (Week 2-3)

- Deploy progressive UI
- Integrate with WebSocket
- User testing and feedback

### 12.4 Phase 4: Full Release

- All optimizations live
- Performance monitoring
- User feedback collection
- Continuous optimization

---

## 13. Dependencies

### 13.1 Internal Dependencies

- **Collaboration PRD**: WebSocket infrastructure for progressive responses
- **Existing Infrastructure**: Lambda, RDS, API Gateway
- **Database Schema**: Existing tables (add indexes only)

### 13.2 External Dependencies

- **AWS Bedrock**: Rate limits and throttling considerations
- **Lambda Limits**: Concurrent execution limits
- **RDS Performance**: Database capacity

---

## 14. Open Questions & Future Enhancements

### 14.1 Open Questions

- Should we implement Redis for distributed caching? (Post-MVP)
- Do we need RDS Proxy for connection pooling? (Post-MVP)
- Should we implement Bedrock streaming API? (If available)
- Do we need CDN caching for static assets? (Already have CloudFront)

### 14.2 Future Enhancements

- **Advanced Caching**

  - Redis for distributed cache
  - Cache warming strategies
  - Predictive pre-fetching

- **Bedrock Optimization**

  - Streaming responses (if supported)
  - Batch API calls
  - Model selection optimization

- **Infrastructure Scaling**

  - Auto-scaling Lambda concurrency
  - RDS read replicas
  - Multi-region deployment

- **Advanced Monitoring**
  - Real-time performance dashboards
  - Predictive performance alerts
  - Cost optimization recommendations

---

## 15. Documentation Requirements

- **Developer Documentation**

  - Parallel processing implementation guide
  - Caching strategy documentation
  - Performance optimization patterns
  - Monitoring and debugging guide

- **Operations Documentation**

  - Lambda configuration guide
  - Database index management
  - Performance monitoring setup
  - Troubleshooting performance issues

- **User Documentation**
  - Understanding progress indicators
  - Cancel generation feature
  - Performance expectations

---

**Last Updated**: January 2025  
**Status**: Planning  
**Dependencies**: Collaboration PRD (for progressive response features)
