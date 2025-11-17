# StenoAI — Real-Time Collaboration Task List

**Status**: Ready for Implementation  
**Last Updated**: January 2025  
**Based on**: `StenoAI_Collaboration_PRD.md`

This document provides a comprehensive, actionable task list for implementing the real-time collaboration feature. Tasks are organized by implementation phase and PR number.

---

## Implementation Order

**Core Collaboration Features** (Must Complete):

1. PR #21: Production-Ready WebSocket Infrastructure
2. PR #22: Y.js Integration Completion
3. PR #25: User Presence System
4. PR #26: Collaboration UI/UX
5. PR #27: Invitation Database & API
6. PR #28: Email Integration
7. PR #29: Invitation UI Components

**Optional Features** (After Performance PRD):

- PR #23: Progressive AI Generation
- PR #24: Refinement Progress

---

## Phase 1: Foundation (Week 1-2)

### PR #21: Production-Ready WebSocket Infrastructure

#### Setup & Configuration

- [ ] **DynamoDB Tables Setup**

  - [ ] Verify `scripts/dynamodb_create.sh` exists and is executable
  - [ ] Run `scripts/dynamodb_create.sh` to create tables:
    - `stenoai-{env}-connections` (with TTL, userId-index, documentId-index GSIs)
    - `stenoai-{env}-document-rooms` (optional, for presence aggregation)
  - [ ] Verify tables created with correct schema
  - [ ] Verify TTL enabled on `connections` table (1 hour expiration)
  - [ ] Test table access from Lambda execution role

- [ ] **IAM Permissions Setup**

  - [ ] Update `infra/iam/stenoai-deploy-policy.json` to include `dynamodb:*` permissions
  - [ ] Verify `infra/api/lambda-dynamodb-policy.json` exists with correct permissions:
    - `dynamodb:PutItem`
    - `dynamodb:GetItem`
    - `dynamodb:UpdateItem`
    - `dynamodb:DeleteItem`
    - `dynamodb:Query`
    - `dynamodb:Scan`
  - [ ] Run `scripts/attach_dynamodb_policy.sh` to attach policy to Lambda execution role
  - [ ] Verify Lambda role has DynamoDB access

- [ ] **Environment Variables**
  - [ ] Verify `APP=stenoai` is set
  - [ ] Verify `ENV=dev` (or appropriate environment) is set
  - [ ] Verify `REGION=us-east-1` (or appropriate region) is set

#### Code Implementation

- [ ] **DynamoDB Integration in `ws_handler.ts`**

  - [ ] Install `@aws-sdk/client-dynamodb` if not already installed
  - [ ] Remove in-memory `Map` for connection tracking
  - [ ] Implement `saveConnection()` function:
    - Save connection to DynamoDB with connectionId as partition key
    - Include userId, documentId (nullable initially), connectedAt, lastActivityAt
    - Set TTL to 1 hour from now
  - [ ] Implement `getConnection()` function:
    - Query DynamoDB by connectionId
    - Return connection data or null
  - [ ] Implement `deleteConnection()` function:
    - Delete connection from DynamoDB
    - Handle GoneException gracefully
  - [ ] Implement `getDocumentConnections()` function:
    - Query DynamoDB by documentId using GSI
    - Return all active connections for a document
  - [ ] Implement `getUserConnections()` function:
    - Query DynamoDB by userId using GSI
    - Return all active connections for a user
  - [ ] Implement `updateConnectionDocument()` function:
    - Update connection record with documentId when user joins room
  - [ ] Update `$connect` handler:
    - Call `saveConnection()` instead of in-memory Map
    - Validate JWT token
    - Extract userId from JWT
    - Check connection limits (10 per user, 100 per document)
    - Return 403 if limit exceeded
  - [ ] Update `$disconnect` handler:
    - Call `deleteConnection()` instead of in-memory Map
    - Broadcast presence leave event to document room
  - [ ] Update `$default` handler:
    - Use `getConnection()` to retrieve connection data
    - Use `getDocumentConnections()` for broadcasting
    - Update `lastActivityAt` on each message

- [ ] **Connection Limits Implementation**

  - [ ] Implement per-user connection limit check (10 connections max)
    - Query `userId-index` GSI to count active connections
    - Return error if limit exceeded: `{ type: 'error', code: 'CONNECTION_LIMIT_EXCEEDED' }`
  - [ ] Implement per-document connection limit check (100 connections max)
    - Query `documentId-index` GSI to count active connections
    - Return error if limit exceeded
  - [ ] Add connection limit error handling in client

- [ ] **Connection Health Monitoring (Heartbeat)**

  - [ ] Implement server-side ping:
    - Send `{ type: 'ping' }` every 30 seconds to all active connections
    - Track missed pongs per connection
    - Close connection after 3 consecutive missed pongs
  - [ ] Implement client-side pong handler:
    - Respond to ping with `{ action: 'pong' }` within 10 seconds
  - [ ] Implement client-side keepalive:
    - Send `{ action: 'ping' }` if no activity for 45 seconds
  - [ ] Update `lastActivityAt` in DynamoDB on ping/pong

- [ ] **Reconnection Handling**

  - [ ] Implement exponential backoff (1s, 2s, 4s, 8s, 16s)
  - [ ] Add max 5 reconnect attempts
  - [ ] Implement `lastKnownVersion` parameter support:
    - Client sends `lastKnownVersion` in join message
    - Server queries ops since that version
    - Server sends only missing ops (efficient sync)
  - [ ] Add reconnection status UI feedback
  - [ ] Handle long disconnect (> 1 hour):
    - Show warning: "You were disconnected for too long. Your local changes may have been lost."
    - Treat as fresh connection (full snapshot sync)

- [ ] **Message Validation & Security**

  - [ ] Implement message size validation (max 1MB):
    - Reject messages > 1MB with `{ type: 'error', code: 'MESSAGE_TOO_LARGE' }`
  - [ ] Implement action validation:
    - Whitelist: `join`, `update`, `presence`, `create_snapshot`, `leave`, `ping`, `pong`
    - Reject invalid actions with `{ type: 'error', code: 'INVALID_ACTION' }`
  - [ ] Implement document ID validation (UUID format):
    - Validate against regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
    - Reject invalid IDs with `{ type: 'error', code: 'INVALID_DOCUMENT_ID' }`
  - [ ] Implement Base64 validation for Y.js updates:
    - Validate Base64 encoding
    - Reject invalid encoding with `{ type: 'error', code: 'INVALID_ENCODING' }`
  - [ ] Implement rate limiting (token bucket algorithm):
    - `updateMessages`: 100 per connection per second
    - `presenceUpdates`: 10 per connection per second
    - `snapshotRequests`: 1 per document per minute
    - `joinAttempts`: 5 per user per minute
    - Return `{ type: 'error', code: 'RATE_LIMIT_EXCEEDED', retryAfter: 1000 }` on limit
  - [ ] Implement Origin header validation:
    - Validate Origin matches allowed domains
    - Reject invalid origins
  - [ ] Enforce WSS (encrypted) connections only
  - [ ] Implement input sanitization:
    - Trim and length-validate all string inputs
    - Prevent script tags/HTML in presence metadata

- [ ] **JWT Expiration Handling**

  - [ ] Validate JWT on `$connect` only (not on every message)
  - [ ] Allow active connections to remain open if JWT expires during session
  - [ ] Require new JWT on reconnection
  - [ ] Add client-side JWT refresh logic (proactive refresh before expiration)

- [ ] **Logout Handling**
  - [ ] Close WebSocket connection on client logout
  - [ ] Server cleans up DynamoDB connection record on `$disconnect`
  - [ ] Broadcast presence leave event to document room
  - [ ] Close all user's connections across all documents

#### Testing

- [ ] **Unit Tests**

  - [ ] Test `saveConnection()` function
  - [ ] Test `getConnection()` function
  - [ ] Test `deleteConnection()` function
  - [ ] Test `getDocumentConnections()` function
  - [ ] Test `getUserConnections()` function
  - [ ] Test connection limit enforcement
  - [ ] Test message validation (size, action, document ID, Base64)
  - [ ] Test rate limiting logic
  - [ ] Test JWT validation on connect

- [ ] **Integration Tests**

  - [ ] Test multiple Lambda instances can see each other's connections
  - [ ] Test connection lifecycle (connect, join, disconnect)
  - [ ] Test connection limits (per user, per document)
  - [ ] Test TTL cleanup (wait 1 hour or manually test)
  - [ ] Test reconnection with `lastKnownVersion`
  - [ ] Test heartbeat mechanism (ping/pong)
  - [ ] Test rate limiting enforcement
  - [ ] Test message validation errors
  - [ ] Test JWT expiration during active session
  - [ ] Test logout handling

- [ ] **E2E Tests**
  - [ ] Test connection establishment and cleanup
  - [ ] Test reconnection scenarios (clean reconnect, reconnect with local edits, long disconnect)
  - [ ] Test connection limits (open 11 connections as same user, verify 11th fails)
  - [ ] Test multiple device connections (same user, different tabs)
  - [ ] Test logout closes all connections

#### Deliverables Checklist

- [ ] DynamoDB tables created and verified
- [ ] IAM permissions updated and verified
- [ ] `ws_handler.ts` updated with DynamoDB integration (no in-memory Map)
- [ ] Connection limits implemented and tested
- [ ] Heartbeat mechanism implemented and tested
- [ ] Reconnection handling implemented and tested
- [ ] Message validation and rate limiting implemented
- [ ] All tests passing

---

### PR #22: Y.js Integration Completion

#### Code Implementation

- [ ] **Fix Y.js Origin Tracking Bug**

  - [ ] Update `apps/web/src/lib/collab/yjs.ts`:
    - In `handleMessage()`, when receiving `update`:
      - Apply update with provider as origin: `Y.applyUpdate(this.doc, updateBuffer, this)`
    - In `ydoc.on("update")` listener:
      - Only send if origin is NOT the provider: `if (origin !== provider && !origin)`
      - Prevent echo back to server
  - [ ] Test that updates don't cause infinite loops (check CloudWatch logs)
  - [ ] Verify local edits are sent, server updates are applied without echo

- [ ] **Complete Y.js Provider Implementation**

  - [ ] Ensure `ApiGatewayWebSocketProvider` class is complete:
    - `connect()` method
    - `disconnect()` method
    - `send()` method
    - `handleMessage()` method
    - `sendUpdate()` method
  - [ ] Implement proper error handling
  - [ ] Implement connection status tracking (`isSynced`, `status`)
  - [ ] Emit status events for UI feedback

- [ ] **Editor.tsx Integration**

  - [ ] Update `apps/web/src/pages/Editor.tsx`:
    - Import Y.js provider and Y.Doc
    - Create Y.Doc instance for document
    - Create Y.Text instance for draft content
    - Bind Y.Text to editor component (two-way binding)
    - Initialize Y.js provider with WebSocket URL and document ID
    - Handle Y.js sync events (synced, update, error)
    - Update editor content when Y.js updates arrive
    - Send Y.js updates when user types
    - Handle reconnection and state sync
  - [ ] Ensure editor updates in real-time from other users
  - [ ] Ensure local edits are sent via Y.js updates

- [ ] **Operation Persistence**

  - [ ] Update `ws_handler.ts` to persist operations:
    - On receiving `update` message, save to `doc_ops` table
    - Include: `document_id`, `operation` (binary), `session_id` (connectionId), `created_at`
    - Use transaction to ensure atomicity
  - [ ] Implement operation replay:
    - Query `doc_ops` table for operations since snapshot version
    - Send operations to client in order
    - Client applies operations to Y.js document

- [ ] **Snapshot Creation Protocol**

  - [ ] Implement server-side snapshot trigger:
    - Check if snapshot needed: `countOpsSinceLastSnapshot() >= 100` OR `timeSinceSnapshot >= 5 minutes`
    - Set document state to "snapshotting" (prevents new snapshot attempts)
    - Broadcast `snapshot_needed` event to all connected clients
  - [ ] Implement client-side snapshot response:
    - Client receives `snapshot_needed` event
    - First client to respond sends `create_snapshot` action with Y.js state (base64)
  - [ ] Implement server-side snapshot creation:
    - Validate snapshot from client
    - Save to `doc_snapshots` table with incremented version
    - Update `lastSnapshotTime`
    - Broadcast `snapshot_created` event with new version
    - Clear "snapshotting" flag
  - [ ] Implement fallback for no connected clients:
    - If no clients respond within 30 seconds, server reconstructs Y.js state
    - Load latest snapshot + all ops since snapshot
    - Apply ops to reconstruct current state
    - Create new snapshot from reconstructed state
  - [ ] Implement snapshot versioning:
    - Each snapshot has incremental `version` number per document
    - Store version in `doc_snapshots.version` column
    - Clients track `lastKnownVersion` for efficient reconnection

- [ ] **Snapshot Cleanup Strategy**

  - [ ] Implement scheduled Lambda (EventBridge) for cleanup:
    - Runs weekly
    - Keep last 10 snapshots per document
    - Delete snapshots older than 30 days
    - Archive old `doc_ops` records older than 90 days (optional)
  - [ ] Create manual cleanup script: `scripts/cleanup_old_snapshots.sh`
  - [ ] Add CloudWatch alarm on cleanup Lambda failures
  - [ ] Log cleanup operations for audit trail

- [ ] **Initial Sync Strategy**

  - [ ] Implement initial sync on `join`:
    - Client sends `join` message with `documentId`
    - Server validates access via `checkDocumentAccess()`
    - Server loads latest snapshot from `doc_snapshots` table (if exists)
    - Server queries `doc_ops` table for all ops since snapshot version
    - If no snapshot exists: use RDS `draft_text` as initial state
    - Server sends snapshot (base64) + ops array (base64[]) to client
    - Client applies snapshot first, then replays all ops in order
    - Client sets `isSynced = true` and emits `synced` event
  - [ ] Implement data migration & backward compatibility:
    - Existing documents: Y.js initialized from RDS `draft_text` on first collaborative open
    - No data migration required (on-demand initialization)
    - Old documents work seamlessly with collaboration enabled
    - Snapshot created on first collaborative edit (after 100 ops or 5 minutes)

- [ ] **Incremental Updates**

  - [ ] Implement client-side update throttling (max 10 updates/second)
  - [ ] Implement server-side operation persistence:
    - Persist operation to `doc_ops` table with `session_id = connectionId`
  - [ ] Implement server-side broadcasting:
    - Query DynamoDB `documentId-index` to get all active connections
    - Broadcast update to all other connections (exclude sender)
  - [ ] Implement message ordering guarantees:
    - Y.js operations are idempotent and order-independent (CRDT property)
    - Server processes messages in order received (per connection)
    - Client applies updates in order received from server
    - Y.js merges operations deterministically regardless of delivery order

- [ ] **Reconnection Sync**

  - [ ] Implement reconnection with `lastKnownVersion`:
    - Client reconnects and sends `join` message with `lastKnownVersion` (optional)
    - Server validates access and loads latest snapshot
    - If `lastKnownVersion` provided, server sends ops since that version
    - Otherwise, server sends latest snapshot + all ops since snapshot
    - Client applies updates and continues editing
    - Client updates `lastKnownVersion` for future reconnects

- [ ] **Helper Function: `checkActiveCollaborators()`**

  - [ ] Create `checkActiveCollaborators(documentId: string): Promise<boolean>` function:
    - Query DynamoDB `documentId-index` GSI for active connections
    - Return `true` if any active connections exist, `false` otherwise
    - Location: `apps/api/src/realtime/persist.ts` or `apps/api/src/lib/collaboration.ts`
    - Used by AI operations and export for backward compatibility

- [ ] **Auto-Save During Collaboration**
  - [ ] Update Editor.tsx auto-save logic:
    - Check `activeUsers.size > 1` to determine if collaboration is active
    - If active: Extract text from `yjsRef.current.ytext.toString()` and save to RDS
    - If inactive: Use existing auto-save logic (save `draftText` state)
    - Auto-save continues to work every 2 seconds (unchanged frequency)
    - Auto-save endpoint (`PUT /documents/:id/draft`) remains unchanged

#### Testing

- [ ] **Unit Tests**

  - [ ] Test Y.js origin tracking (no infinite loops)
  - [ ] Test operation persistence
  - [ ] Test snapshot creation
  - [ ] Test snapshot replay
  - [ ] Test initial sync
  - [ ] Test incremental updates
  - [ ] Test reconnection sync

- [ ] **Integration Tests**

  - [ ] Test Y.js updates don't cause infinite loops
  - [ ] Test snapshot creation doesn't conflict with multiple clients
  - [ ] Test operation persistence and replay
  - [ ] Test initial sync from RDS `draft_text`
  - [ ] Test reconnection with `lastKnownVersion`
  - [ ] Test message ordering (out-of-order messages handled correctly)
  - [ ] Test data migration (old documents work with collaboration)

- [ ] **E2E Tests**
  - [ ] Test two users editing simultaneously
  - [ ] Test conflict resolution with concurrent edits
  - [ ] Test reconnection during editing
  - [ ] Test Y.js state syncs to RDS on snapshot creation
  - [ ] Test message ordering (CRDT merge works with out-of-order delivery)

#### Deliverables Checklist

- [ ] Y.js origin tracking fixed (no infinite loops)
- [ ] Y.js provider implementation complete
- [ ] Editor.tsx integrated with Y.js
- [ ] Operation persistence working
- [ ] Snapshot creation protocol working
- [ ] Snapshot cleanup strategy implemented
- [ ] Initial sync working
- [ ] Reconnection sync working
- [ ] All tests passing

---

## Phase 2: Progressive Generation (Optional - After Performance PRD)

### PR #23: Progressive AI Generation (Post-Performance PRD - Optional)

**Note**: This PR depends on parallel chunk processing from the Performance PRD. Implement after core collaboration is complete.

- [ ] Create `apps/api/src/realtime/notify.ts` module
- [ ] Implement `notifyProgress()` function to broadcast to connected clients
- [ ] Update `apps/api/src/routes/generate.ts` to send progress events after each chunk completes
- [ ] Add progress UI components (progress bar, status messages)
- [ ] Implement generation lock (disable editing during generation)
- [ ] Apply generated text as Y.js update on completion
- [ ] Test progressive generation with collaboration

### PR #24: Refinement Progress (Post-Performance PRD - Optional)

**Note**: This PR depends on parallel chunk processing from the Performance PRD. Implement after core collaboration is complete.

- [ ] Add progress events for refinement operations
- [ ] Update `apps/api/src/routes/refine.ts` to send progress
- [ ] Add refinement progress UI
- [ ] Implement refinement lock (disable editing during refinement)
- [ ] Apply refined text as Y.js update on completion
- [ ] Test refinement progress with collaboration

---

## Phase 3: Presence & Awareness (Week 3-4)

### PR #25: User Presence System

#### Code Implementation

- [ ] **Presence Tracking in `ws_handler.ts`**

  - [ ] Implement presence tracking on `join`:
    - Query DynamoDB for all active connections for document
    - Deduplicate by userId (same user can have multiple connections)
    - Broadcast `presence` event with `action: 'join'` and `userId`
    - Include user metadata (name, avatar if available)
  - [ ] Implement presence tracking on `leave`:
    - On `$disconnect`, broadcast `presence` event with `action: 'leave'` and `userId`
    - Check if user has other active connections (multiple devices)
    - Only broadcast leave if user has no other connections
  - [ ] Implement presence update on activity:
    - Update `lastActivityAt` in DynamoDB
    - Optionally broadcast `presence` event with `action: 'activity'` and `userId`
  - [ ] Implement presence query:
    - API endpoint: `GET /documents/:id/presence` (optional, for initial load)
    - Returns list of active users for document

- [ ] **ActiveUsersSidebar Component**

  - [ ] Create `apps/web/src/components/ActiveUsersSidebar.tsx`:
    - Display list of active users
    - Show user avatars and names
    - Show connection status (online, typing, idle)
    - Show last activity timestamp
    - Handle join/leave notifications
    - Collapsible sidebar
  - [ ] Integrate with Editor.tsx
  - [ ] Style with Tailwind CSS
  - [ ] Make responsive (hide on mobile, show on desktop)

- [ ] **Connection Status Indicators**

  - [ ] Create connection status badge component:
    - Green: Connected
    - Yellow: Reconnecting
    - Red: Disconnected
  - [ ] Display connection status in Editor toolbar
  - [ ] Show network quality indicator (green/yellow/red based on latency)
  - [ ] Show reconnection progress with countdown

- [ ] **Join/Leave Notifications**
  - [ ] Implement toast notifications for join/leave events
  - [ ] Show user name in notification
  - [ ] Auto-dismiss after 3 seconds
  - [ ] Optional: Sound notification (user preference)

#### Testing

- [ ] **Unit Tests**

  - [ ] Test presence tracking logic
  - [ ] Test presence deduplication (multiple connections for same user)
  - [ ] Test presence query

- [ ] **Integration Tests**

  - [ ] Test presence updates on join/leave
  - [ ] Test presence with multiple users
  - [ ] Test presence with multiple devices (same user)
  - [ ] Test connection status indicators

- [ ] **E2E Tests**
  - [ ] Test presence indicators
  - [ ] Test join/leave notifications
  - [ ] Test active users sidebar
  - [ ] Test multiple device presence (same user, different tabs)

#### Deliverables Checklist

- [ ] Presence tracking implemented in `ws_handler.ts`
- [ ] ActiveUsersSidebar component created
- [ ] Connection status indicators implemented
- [ ] Join/leave notifications implemented
- [ ] All tests passing

---

### PR #26: Collaboration UI/UX

#### Code Implementation

- [ ] **Document Sync Status Indicators**

  - [ ] Create sync status component:
    - Synced: Green checkmark
    - Syncing: Yellow spinner
    - Conflict: Red warning (shouldn't happen with CRDT, but handle gracefully)
  - [ ] Display sync status in Editor
  - [ ] Show last sync timestamp
  - [ ] Add manual sync trigger button (optional, for debugging)

- [ ] **Reconnection Feedback**

  - [ ] Implement reconnection UI feedback:
    - Show "Reconnecting..." message with attempt count
    - Show progress indicator
    - Show "Connected" success message
    - Show "Connection failed" error with retry button
  - [ ] Make reconnection transparent to user
  - [ ] Preserve user's work during reconnection

- [ ] **Error Handling & User Notifications**

  - [ ] Implement user-friendly error messages:
    - ✅ Connected: "Connected to real-time collaboration"
    - ⚠️ Reconnecting: "Connection lost. Reconnecting... (Attempt 2 of 5)"
    - ❌ Disconnected: "Unable to connect. Click to retry or refresh the page."
    - 🔒 Access Denied: "You no longer have access to this document"
    - ⏱️ Generating: "AI is generating draft. Editing will be re-enabled shortly."
    - ⏱️ Refining: "AI is refining draft. Editing will be re-enabled shortly."
    - ⏱️ Restoring: "Document is being restored to a previous version. Editing will be re-enabled shortly."
    - 👥 Collaboration: "Another user is editing. Changes will sync automatically."
    - ⚠️ Restore Warning: "Document was restored to a previous version. Your recent edits may have been lost."
  - [ ] Implement error toast notifications
  - [ ] Implement error boundary for collaboration errors
  - [ ] Log errors to console (development) and error tracking (production)

- [ ] **Polish & Accessibility**
  - [ ] Add keyboard shortcuts for collaboration features
  - [ ] Add ARIA labels for screen readers
  - [ ] Ensure color contrast meets WCAG AA standards
  - [ ] Add focus indicators for interactive elements
  - [ ] Test with screen reader
  - [ ] Test keyboard navigation
  - [ ] Add loading states for all async operations
  - [ ] Add tooltips for collaboration features
  - [ ] Ensure responsive design works on tablet

#### Testing

- [ ] **Unit Tests**

  - [ ] Test sync status component
  - [ ] Test reconnection feedback component
  - [ ] Test error message rendering

- [ ] **Integration Tests**

  - [ ] Test sync status updates
  - [ ] Test reconnection feedback
  - [ ] Test error handling

- [ ] **E2E Tests**
  - [ ] Test sync status indicators
  - [ ] Test reconnection feedback
  - [ ] Test error messages display correctly
  - [ ] Test accessibility (keyboard navigation, screen reader)

#### Deliverables Checklist

- [ ] Sync status components implemented
- [ ] Reconnection UI feedback implemented
- [ ] Error boundary improvements
- [ ] Accessibility enhancements
- [ ] All tests passing

---

## Phase 4: Invitation System (Week 5-6)

### PR #27: Invitation Database & API

#### Setup & Configuration

- [ ] **Database Migration**
  - [ ] Create migration file `apps/api/migrations/0007_invitations.sql`:
    - Create `invitations` table with schema:
      - `id` (UUID, PRIMARY KEY)
      - `document_id` (UUID, FOREIGN KEY to documents, ON DELETE CASCADE)
      - `inviter_id` (UUID, FOREIGN KEY to users, ON DELETE CASCADE)
      - `invitee_email` (VARCHAR(255), NOT NULL)
      - `invitee_user_id` (UUID, FOREIGN KEY to users, ON DELETE SET NULL, nullable)
      - `role` (VARCHAR(50), NOT NULL, DEFAULT 'editor')
      - `status` (VARCHAR(50), NOT NULL, DEFAULT 'pending')
      - `token` (VARCHAR(255), NOT NULL, UNIQUE)
      - `expires_at` (TIMESTAMP, NOT NULL)
      - `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
      - `accepted_at` (TIMESTAMP, nullable)
      - `declined_at` (TIMESTAMP, nullable)
      - `cancelled_at` (TIMESTAMP, nullable)
      - Unique constraint on `(document_id, invitee_email)` where `status = 'pending'`
    - Create indexes:
      - `idx_invitations_invitee_email` on `invitee_email`
      - `idx_invitations_invitee_user_id` on `invitee_user_id`
      - `idx_invitations_token` on `token`
      - `idx_invitations_status` on `status`
      - `idx_invitations_document_id` on `document_id`
  - [ ] Run migration via `scripts/migrate.sh` or `scripts/migrate_via_lambda.sh`
  - [ ] Verify table and indexes created successfully

#### Code Implementation

- [ ] **Token Generation Utility**

  - [ ] Create `apps/api/src/lib/token.ts`:
    - Implement `generateInvitationToken()` function:
      - Use `crypto.randomBytes(32)` for cryptographically secure token
      - Base64 URL-safe encode token
      - Ensure token is unique (check database)
      - Return token string
    - Implement `validateToken()` function:
      - Check token format
      - Check token exists in database
      - Check token expiration
      - Return validation result

- [ ] **Database Helper Functions**

  - [ ] Add to `apps/api/src/db/pg.ts`:
    - `createInvitation()` - Create invitation record
    - `getInvitationByToken()` - Get invitation by token
    - `getInvitationsByUser()` - Get all pending invitations for user
    - `getInvitationsByDocument()` - Get all invitations for document
    - `acceptInvitation()` - Accept invitation (transaction with document_collaborators creation)
    - `declineInvitation()` - Decline invitation
    - `cancelInvitation()` - Cancel invitation
    - `resendInvitation()` - Resend invitation (new token, update expiration)
    - `expireInvitations()` - Mark expired invitations (scheduled Lambda)
    - `checkInvitationStatus()` - Check if invitation is valid (not expired, not cancelled, etc.)

- [ ] **API Route: Collaborators**

  - [ ] Create `apps/api/src/routes/collaborators.ts`:
    - `POST /documents/:id/invitations` - Create invitation (owner only)
      - Validate user is owner
      - Validate email format (RFC 5322)
      - Check if user already has access (return error if yes)
      - Check invitation rate limits (50 per document/hour, 10 per user/hour)
      - Generate secure token
      - Create invitation record
      - Return invitation data
    - `GET /invitations` - List pending invitations for current user
      - Query by `invitee_user_id` OR `invitee_email` (if user not found by ID)
      - Filter by `status = 'pending'`
      - Return list of invitations with document/inviter details
    - `GET /invitations/:token` - Get invitation details by token (public)
      - Validate token
      - Return invitation details (document title, inviter name, role, expiration)
      - Don't require authentication (for acceptance page)
    - `POST /invitations/:token/accept` - Accept invitation
      - Validate token and expiration
      - Check if already accepted (concurrent acceptance prevention)
      - Check email match (if logged in)
      - Create `document_collaborators` record (within transaction)
      - Update invitation status to `'accepted'`
      - Set `accepted_at` timestamp
      - Return success
    - `POST /invitations/:token/decline` - Decline invitation
      - Validate token
      - Update invitation status to `'declined'`
      - Set `declined_at` timestamp
      - Return success
    - `GET /documents/:id/collaborators` - List all collaborators (owner only)
      - Query `document_collaborators` table
      - Include owner from `documents.owner_id`
      - Return list with roles
    - `DELETE /documents/:id/collaborators/:userId` - Remove collaborator (owner only)
      - Validate user is owner
      - Delete `document_collaborators` record
      - Disconnect active WebSocket connections for that user
      - Broadcast `access_revoked` event
      - Return success
    - `PATCH /documents/:id/collaborators/:userId` - Change collaborator role (owner only)
      - Validate user is owner
      - Update role in `document_collaborators` table
      - If changed to viewer: disconnect active WebSocket if user is editing
      - Broadcast `role_changed` event to affected user
      - Return success
    - `POST /documents/:id/invitations/:invitationId/resend` - Resend invitation (owner only)
      - Validate user is owner
      - Generate new token (old token becomes invalid)
      - Update `expires_at` to 7 days from now
      - Update invitation record
      - Return success (email sent asynchronously)
    - `POST /documents/:id/invitations/:invitationId/cancel` - Cancel invitation (owner only)
      - Validate user is owner
      - Update invitation status to `'cancelled'`
      - Set `cancelled_at` timestamp
      - Return success

- [ ] **Invitation Validation Logic**

  - [ ] Implement email format validation (RFC 5322 compliant)
  - [ ] Implement expiration check (7 days from creation)
  - [ ] Implement status validation (pending, accepted, declined, expired, cancelled)
  - [ ] Implement concurrent acceptance prevention (database transaction with row-level lock)
  - [ ] Implement duplicate invitation prevention (unique constraint on pending invitations)
  - [ ] Implement rate limiting (50 per document/hour, 10 per user/hour)

- [ ] **Integration with `document_collaborators` Table**

  - [ ] Ensure `acceptInvitation()` creates `document_collaborators` record atomically
  - [ ] Ensure `deleteCollaborator()` removes `document_collaborators` record
  - [ ] Ensure `updateCollaboratorRole()` updates `document_collaborators` record
  - [ ] Handle cascade deletes (document deletion, user deletion)

- [ ] **Expiration Cleanup Mechanism**
  - [ ] Option A (Recommended): Create scheduled Lambda (EventBridge):
    - Runs daily
    - Query invitations where `expires_at < NOW()` AND `status = 'pending'`
    - Update status to `'expired'` in batch
    - Log cleanup operations
  - [ ] Option B (MVP Simplicity): On-demand check:
    - Check `expires_at` on acceptance attempt
    - Mark as expired if past expiration date
    - Note: Expired invitations remain in database until accessed

#### Testing

- [ ] **Unit Tests**

  - [ ] Test token generation (cryptographically secure, unique)
  - [ ] Test token validation
  - [ ] Test invitation creation
  - [ ] Test invitation expiration handling
  - [ ] Test email format validation
  - [ ] Test rate limiting logic

- [ ] **Integration Tests**

  - [ ] Test invitation creation and acceptance flow
  - [ ] Test invitation resend and cancellation
  - [ ] Test email mismatch scenario (wrong email logged in)
  - [ ] Test concurrent invitation acceptance (race condition prevention)
  - [ ] Test inviting existing collaborator (error handling)
  - [ ] Test invitation rate limiting enforcement
  - [ ] Test collaborator removal and access revocation
  - [ ] Test role change (editor ↔ viewer)
  - [ ] Test invitation expiration and cleanup (scheduled vs on-demand)
  - [ ] Test document deletion during active collaboration
  - [ ] Test user account deletion cascading behavior
  - [ ] Test invalid token error messages (expired, cancelled, already accepted)

- [ ] **E2E Tests**
  - [ ] Test complete invitation flow: invite → email → accept → collaborate
  - [ ] Test invitation acceptance for logged-out users (sign up flow)
  - [ ] Test email mismatch handling (wrong email logged in)
  - [ ] Test concurrent invitation acceptance prevention
  - [ ] Test invalid token error messages display correctly
  - [ ] Test inviting existing collaborator error handling
  - [ ] Test invitation resend and cancellation
  - [ ] Test role change workflow (editor ↔ viewer)
  - [ ] Test collaborator removal and WebSocket disconnection
  - [ ] Test document deletion during active collaboration
  - [ ] Test user account deletion and cascading effects

#### Deliverables Checklist

- [ ] Migration file `0007_invitations.sql` created and run
- [ ] API route `apps/api/src/routes/collaborators.ts` implemented
- [ ] Database helper functions in `apps/api/src/db/pg.ts` implemented
- [ ] Token generation utility implemented
- [ ] Expiration check middleware implemented
- [ ] All API endpoints tested
- [ ] All tests passing

---

### PR #28: Invitation UI Components

#### Code Implementation

- [ ] **Share Modal in Editor**

  - [ ] Create `apps/web/src/components/ShareModal.tsx`:
    - "Share Document" button in Editor toolbar
    - Modal displays:
      - Current collaborators list:
        - Owner (with badge)
        - Editors (with role badge)
        - Viewers (with role badge)
        - Show names/emails
        - Remove collaborator action (owner only, with confirmation)
        - Change role action (owner only, editor ↔ viewer)
      - Invite form:
        - Email input field
        - Role selector dropdown (editor/viewer)
        - "Send Invitation" button
        - Email format validation
        - Error handling (duplicate invitation, rate limit, etc.)
      - Pending invitations list:
        - Show invitee email, role, expiration date
        - Resend invitation button (owner only)
        - Cancel invitation button (owner only)
        - Status indicators (pending, expired, failed)
    - Handle invitation creation
    - Handle invitation resend
    - Handle invitation cancellation
    - Handle collaborator removal
    - Handle role change
    - Responsive design (mobile-friendly)
  - [ ] Integrate with Editor.tsx
  - [ ] Style with Tailwind CSS

- [ ] **Invitations Page**

  - [ ] Create `apps/web/src/pages/Invitations.tsx`:
    - Lists all pending invitations for logged-in user
    - Shows:
      - Document title (link to document)
      - Inviter name and email
      - Assigned role (editor/viewer)
      - Expiration date
      - Created date
    - Accept/Decline buttons for each invitation
    - Link to document after acceptance
    - Empty state if no pending invitations
    - Loading state
    - Error handling
    - Responsive design
  - [ ] Add route: `/invitations`
  - [ ] Update navigation to include link to invitations page
  - [ ] Style with Tailwind CSS

- [ ] **Acceptance Page**

  - [ ] Create `apps/web/src/pages/InvitationAccept.tsx`:
    - Public route: `/invitations/accept/:token` (works without auth)
    - Displays invitation details:
      - Document title
      - Inviter name and email
      - Assigned role
      - Expiration date
    - If user is not logged in:
      - Show "Sign Up" or "Log In" buttons
      - After authentication, redirect back to acceptance page
    - If user is logged in:
      - Show "Accept" or "Decline" buttons
      - Handle email mismatch:
        - Show error: "This invitation was sent to {invitee_email}. Please log in with that email address."
        - Provide option to log out and log in with correct email
    - Handle token validation errors:
      - Expired: "This invitation has expired. Please request a new invitation."
      - Cancelled: "This invitation has been cancelled."
      - Already accepted: "This invitation has already been accepted."
      - Invalid: "Invalid invitation link."
    - After acceptance: redirect to `/documents/:id`
    - After decline: show confirmation message
    - Loading state
    - Error handling
    - Responsive design
  - [ ] Add route: `/invitations/accept/:token`
  - [ ] Style with Tailwind CSS

- [ ] **Dashboard Enhancement**

  - [ ] Update `apps/web/src/pages/Dashboard.tsx`:
    - Add invitation count badge (shows number of pending invitations)
    - Add link to `/invitations` page
    - Optional: Recent invitations list widget
    - Update when invitations are accepted/declined
  - [ ] Style with Tailwind CSS

- [ ] **Router Updates**
  - [ ] Add routes to `apps/web/src/AppRouter.tsx`:
    - `/invitations` - Invitations page
    - `/invitations/accept/:token` - Acceptance page (public route)
  - [ ] Ensure public route doesn't require authentication

#### Testing

- [ ] **Unit Tests**

  - [ ] Test ShareModal component
  - [ ] Test Invitations page component
  - [ ] Test InvitationAccept page component
  - [ ] Test Dashboard enhancement

- [ ] **Integration Tests**

  - [ ] Test invitation creation from ShareModal
  - [ ] Test invitation resend from ShareModal
  - [ ] Test invitation cancellation from ShareModal
  - [ ] Test collaborator removal from ShareModal
  - [ ] Test role change from ShareModal
  - [ ] Test invitation acceptance from Invitations page
  - [ ] Test invitation acceptance from Acceptance page
  - [ ] Test email mismatch handling
  - [ ] Test token validation errors

- [ ] **E2E Tests**
  - [ ] Test complete invitation flow: invite → email → accept → collaborate
  - [ ] Test invitation acceptance for logged-out users (sign up flow)
  - [ ] Test email mismatch handling (wrong email logged in)
  - [ ] Test invalid token error messages display correctly
  - [ ] Test invitation resend and cancellation
  - [ ] Test role change workflow (editor ↔ viewer)
  - [ ] Test collaborator removal
  - [ ] Test responsive design (mobile, tablet, desktop)

#### Deliverables Checklist

- [ ] ShareModal component created and integrated
- [ ] Invitations page component created
- [ ] Acceptance page component created
- [ ] Dashboard invitation badge added
- [ ] Router updates for new routes
- [ ] Responsive design for all components
- [ ] All tests passing

---

## AI Operations Integration

### AI Generation During Collaboration

- [ ] **Generation Lock Implementation**

  - [ ] Update `apps/api/src/routes/generate.ts`:
    - Check document status before generation (must not be `"generating"`, `"refining"`, or `"restoring"`)
    - Set document status to `"generating"` in RDS
    - Broadcast `generation_started` event to all connected clients via WebSocket
    - Disable editing in UI (client-side)
  - [ ] Update generation completion with backward compatibility:
    - Check for active collaborators using `checkActiveCollaborators(documentId)`
    - **If active collaborators exist**:
      - On completion, apply generated text as single Y.js update
      - Broadcast `generation_complete` event with full draft text to all connected clients
      - Update `draft_text` in RDS (for consistency and auto-save compatibility)
      - Set document status back to `"draft_generated"`
      - Re-enable editing in UI
    - **If no active collaborators (solo editing)**:
      - Use existing RDS update behavior (backward compatible)
      - Update `draft_text` in RDS directly
      - No WebSocket events needed (no other users to notify)
      - Set document status back to `"draft_generated"`
      - Re-enable editing in UI
  - [ ] Update error handling:
    - If generation fails, broadcast `generation_error` event
    - Document state returns to previous state
    - Re-enable editing automatically
  - [ ] Update client-side Editor.tsx:
    - Listen for `generation_started` event
    - Show "AI is generating..." indicator
    - Disable editing during generation
    - Listen for `generation_complete` event
    - Apply generated text via Y.js update
    - Re-enable editing

- [ ] **AI Operation Permissions**
  - [ ] Validate user role before processing generation request:
    - Owner and editors can trigger (viewers cannot)
    - Return error if viewer attempts: `{ error: 'Read-only access. You cannot trigger AI operations.' }`
  - [ ] Validate concurrent operation prevention:
    - Check document status before starting generation
    - Return error if operation already in progress: `{ error: 'AI operation already in progress. Please wait for current operation to complete.' }`

#### Testing

- [ ] Test generation lock works correctly
- [ ] Test generation events broadcast to all connected clients
- [ ] Test concurrent AI operation prevention
- [ ] Test AI operation permissions enforced (viewers cannot trigger)
- [ ] Test generation properly integrates with Y.js (generated text syncs to all users)
- [ ] Test generation backward compatibility (solo editing uses existing RDS update)
- [ ] Test generation with active collaborators (uses Y.js update + WebSocket broadcast)

---

### AI Refinement During Collaboration

- [ ] **Refinement Lock Implementation**
  - [ ] Update `apps/api/src/routes/refine.ts`:
    - Check document status before refinement (must not be `"generating"`, `"refining"`, or `"restoring"`)
    - Validate user role (owner or editor only)
    - Set document status to `"refining"` in RDS
    - Broadcast `refinement_started` event to all connected clients via WebSocket
    - Disable editing in UI (client-side)
  - [ ] Update refinement completion with backward compatibility:
    - Check for active collaborators using `checkActiveCollaborators(documentId)`
    - **If active collaborators exist**:
      - On completion, apply refined text as single Y.js update
      - Broadcast `refinement_complete` event with full refined text to all connected clients
      - Update `draft_text` in RDS (for consistency and auto-save compatibility)
      - Set document status back to `"draft"` or `"draft_generated"`
      - Re-enable editing in UI
    - **If no active collaborators (solo editing)**:
      - Use existing RDS update behavior (backward compatible)
      - Update `draft_text` in RDS directly
      - No WebSocket events needed (no other users to notify)
      - Set document status back to `"draft"` or `"draft_generated"`
      - Re-enable editing in UI
  - [ ] Update error handling:
    - If refinement fails, broadcast `refinement_error` event
    - Document state returns to previous state
    - Re-enable editing automatically
  - [ ] Update client-side Editor.tsx:
    - Listen for `refinement_started` event
    - Show "AI is refining draft..." indicator
    - Disable editing during refinement
    - Listen for `refinement_complete` event
    - Apply refined text via Y.js update
    - Re-enable editing

#### Testing

- [ ] Test refinement lock works correctly (same as generation lock)
- [ ] Test refinement events broadcast to all connected clients
- [ ] Test concurrent AI operation prevention (generation + refinement cannot run simultaneously)
- [ ] Test AI operation permissions enforced (viewers cannot trigger)
- [ ] Test refinement backward compatibility (solo editing uses existing RDS update)
- [ ] Test refinement with active collaborators (uses Y.js update + WebSocket broadcast)

---

### History Restore During Collaboration

- [ ] **Restore Lock Implementation**
  - [ ] Update `apps/api/src/routes/refine.ts` (or create restore route):
    - Validate user is owner (only owner can restore)
    - Check for active collaborators (query DynamoDB)
    - If active collaborators exist: return warning requiring confirmation
    - Check document status (must not be `"generating"`, `"refining"`, or `"restoring"`)
    - Set document status to `"restoring"` in RDS
    - Broadcast `restore_started` event to all connected clients via WebSocket
    - Disable editing in UI (client-side)
  - [ ] Update restore completion:
    - Load restored text from `refinements` table
    - Update `draft_text` in RDS
    - Create new Y.js document instance (discards old state)
    - Apply restored text as complete Y.js update (full replacement)
    - Create new snapshot from restored state
    - Broadcast `restore_complete` event with restored text
    - Set document status back to `"draft"` or `"draft_generated"`
    - Re-enable editing in UI
    - Show warning to collaborators: "Document was restored to a previous version. Your recent edits may have been lost."
  - [ ] Update error handling:
    - If restore fails, broadcast `restore_error` event
    - Document state returns to previous state
    - Re-enable editing automatically
  - [ ] Update client-side Editor.tsx:
    - Listen for `restore_started` event
    - Show "Document is being restored..." indicator
    - Disable editing during restore
    - Listen for `restore_complete` event
    - Replace entire Y.js document with restored version
    - Show warning message
    - Re-enable editing

#### Testing

- [ ] Test restore lock works correctly (same as generation/refinement lock)
- [ ] Test restore events broadcast to all connected clients
- [ ] Test restore permissions enforced (only owner can restore)
- [ ] Test restore warning shown when active collaborators exist
- [ ] Test Y.js state reset on restore (complete document replacement)
- [ ] Test restore overwrites collaborative edits correctly

---

### Export During Collaboration

- [ ] **Export Implementation with Backward Compatibility**
  - [ ] Update `apps/api/src/routes/export.ts`:
    - Check for active collaborators using `checkActiveCollaborators(documentId)`
    - **If active collaborators exist**:
      - Export uses current Y.js state (not RDS `draft_text`) to capture latest collaborative edits
      - Server reads current Y.js state from connected clients (or reconstructs from snapshot + ops)
      - Converts Y.js text to Word document format
      - Uploads to S3 and returns download link
    - **If no active collaborators (solo editing)**:
      - Use existing RDS `draft_text` (backward compatible)
      - Read `draft_text` from RDS directly
      - Converts to Word document format
      - Uploads to S3 and returns download link
    - Export is read-only operation (doesn't lock document or prevent editing)
    - Multiple users can export simultaneously (no conflicts)
    - Other users can continue editing during export (no interruption)

#### Testing

- [ ] Test export uses Y.js state (not RDS draft_text) during collaboration
- [ ] Test export backward compatibility (solo editing uses RDS draft_text)
- [ ] Test export doesn't block editing (multiple exports can run simultaneously)
- [ ] Test export reflects latest collaborative edits at time of export

---

### Document Metadata Changes During Collaboration

- [ ] **Metadata Changes Implementation**
  - [ ] Update document title change endpoint:
    - Validate user is owner (only owner can change title)
    - Update `documents.title` in RDS
    - Broadcast `metadata_changed` event to all connected clients: `{ type: 'metadata_changed', metadata: { title: newTitle } }`
    - Other users see title update in real-time (no page refresh needed)
  - [ ] Update client-side Editor.tsx:
    - Listen for `metadata_changed` event
    - Update document title in UI
  - [ ] Template selection:
    - Template selection is per-generation (not stored in document)
    - Changing template doesn't affect active collaboration
    - Template used for next generation only
    - No WebSocket events needed for template changes

#### Testing

- [ ] Test document metadata changes broadcast to all clients
- [ ] Test template selection doesn't affect active collaboration

---

## Viewer Role Implementation

- [ ] **Viewer Role Enforcement**
  - [ ] Update `ws_handler.ts`:
    - Check user role before processing `update` messages
    - If user has `viewer` role: reject `update` message with `{ type: 'error', code: 'READ_ONLY_ACCESS', message: 'You have read-only access to this document' }`
    - Viewers can send `join`, `presence`, `ping`, `pong` messages (read-only operations)
    - Viewers cannot send `update` or `create_snapshot` messages
    - Viewers still receive all broadcast updates (they can see edits but cannot edit)
  - [ ] Update client-side Editor.tsx:
    - Disable editing controls for viewers (input fields disabled)
    - Show visual indicator: "Read-only" badge or message
    - Viewers can see real-time updates but cannot modify document content

#### Testing

- [ ] Test viewer role cannot send update messages (READ_ONLY_ACCESS error)
- [ ] Test viewers can receive real-time updates but cannot edit
- [ ] Test role change (editor ↔ viewer) works correctly
- [ ] Test role change during active session enforces new permissions immediately

---

## State Synchronization (Y.js vs RDS)

- [ ] **State Management Strategy Implementation**
  - [ ] During Active Collaboration: Y.js is source of truth (in-memory CRDT state)
  - [ ] On Document Load: Y.js initialized from RDS `draft_text` (authoritative source)
  - [ ] On Snapshot Creation: Y.js state saved to RDS `draft_text` (periodic sync)
  - [ ] After AI Operations: Both Y.js and RDS updated atomically (generation/refinement)
  - [ ] State Reconciliation:
    - On document load: Y.js initialized from RDS (RDS is authoritative)
    - During collaboration: Y.js is source of truth (most recent edits)
    - On snapshot: Y.js state saved to RDS (sync point)
    - Conflict resolution: Y.js state always wins (most recent collaborative edits)

#### Testing

- [ ] Test Y.js state syncs to RDS on snapshot creation
- [ ] Test data migration works (old documents initialize Y.js from RDS)
- [ ] Test state synchronization (Y.js vs RDS)
- [ ] Test auto-save during collaboration (saves Y.js state to RDS)
- [ ] Test auto-save during solo editing (uses existing behavior)
- [ ] Test `checkActiveCollaborators()` function works correctly

---

## Document Deletion Handling

- [ ] **Document Deletion Implementation**
  - [ ] Update document deletion endpoint:
    - If document is deleted while collaborators are active:
      - Server broadcasts `document_deleted` event to all connected clients
      - All WebSocket connections for that document closed gracefully
      - Clients show notification: "This document has been deleted"
      - Redirect users to Dashboard
    - Pending invitations for deleted document automatically marked as `'expired'`
    - All `document_collaborators` records cascade deleted (via database foreign key)

#### Testing

- [ ] Test document deletion disconnects all collaborators and expires invitations

---

## User Account Deletion Handling

- [ ] **User Account Deletion Implementation**
  - [ ] Update user deletion logic:
    - If inviter account deleted: all pending invitations they sent are cancelled (CASCADE deletes invitation records)
    - If invitee account deleted: `invitee_user_id` set to NULL, but `invitee_email` remains in invitation record
    - If user accepts invitation after account recreation: new `invitee_user_id` populated on acceptance
    - Active collaborations: `document_collaborators` records deleted (CASCADE)
    - WebSocket connections: closed and cleaned up on user deletion
    - Documents owned by deleted user: cascade deleted (CASCADE on `documents.owner_id`)

#### Testing

- [ ] Test user account deletion cascades correctly (invitations, collaborations)

---

## Monitoring & Observability

- [ ] **CloudWatch Metrics**

  - [ ] Implement metrics for:
    - Active connections count (per document, per user, total)
    - WebSocket message latency (p50, p95, p99 percentiles)
    - Error rates by type (connection failures, message errors, access denied)
    - Invitation metrics (sent, accepted, declined, expired rates)
    - Snapshot creation frequency and duration
    - AI operation metrics (generation/refinement start, completion, failure rates)
    - DynamoDB read/write capacity utilization
    - Y.js operation broadcast latency

- [ ] **CloudWatch Alarms**

  - [ ] Create alarms for:
    - High error rate (> 5% for 5 minutes) - triggers notification
    - Connection failures (> 10% for 5 minutes) - triggers alert
    - DynamoDB throttling events - triggers scaling action
    - High message latency (p95 > 500ms for 5 minutes) - performance alert
    - AI operation failures (> 10% for 10 minutes) - service degradation alert

- [ ] **Logging**

  - [ ] Implement logging for:
    - All WebSocket events (connect, disconnect, join, update, presence)
    - Access denied attempts with user/document context (security audit trail)
    - AI operation events (generation/refinement start, complete, error)
    - Invitation lifecycle events (create, accept, decline, expire, cancel)
    - Snapshot creation events with timing and size metrics
    - Error logs with full context (userId, documentId, connectionId, error details)

- [ ] **Dashboards**
  - [ ] Create CloudWatch dashboards:
    - Real-time collaboration dashboard (active users, documents, connections)
    - Performance dashboard (latency, throughput, error rates)
    - Invitation analytics dashboard (acceptance rates, time to accept)
    - System health dashboard (DynamoDB, RDS, Lambda metrics)

---

## Testing Requirements

### Comprehensive Testing Checklist

Before marking any PR complete, verify:

#### Core Collaboration

- [ ] Multiple Lambda instances can see each other's connections (test with 2+ concurrent connections)
- [ ] Reconnection works with `lastKnownVersion` parameter
- [ ] Y.js updates don't cause infinite loops (check CloudWatch logs)
- [ ] AI generation properly integrates with Y.js (generated text syncs to all users)
- [ ] Snapshot creation doesn't conflict with multiple clients
- [ ] DynamoDB TTL cleans up stale connections (wait 1 hour or manually test)
- [ ] Permission revocation disconnects affected users
- [ ] Message ordering handled correctly (CRDT merge works with out-of-order messages)
- [ ] Data migration works (old documents initialize Y.js from RDS)

#### Invitation System

- [ ] Invitation tokens are cryptographically secure and unique
- [ ] Invitation expiration works correctly (test with expired tokens)
- [ ] Email delivery works for invitation links
- [ ] Invitation acceptance creates `document_collaborators` record
- [ ] Invitation acceptance works for both logged-in and logged-out users
- [ ] Email mismatch scenario handled correctly (wrong email logged in)
- [ ] Invitation resend creates new token and invalidates old token
- [ ] Invitation cancellation prevents acceptance
- [ ] Cancelled invitation shows appropriate error message
- [ ] Duplicate pending invitations are prevented (unique constraint)
- [ ] Invitation status transitions work correctly (pending → accepted/declined/expired/cancelled)
- [ ] Concurrent invitation acceptance prevented (race condition handling)
- [ ] Invalid token error messages display correctly (expired, cancelled, already accepted)
- [ ] Inviting existing collaborator returns appropriate error
- [ ] Invitation rate limiting works (50 per document/hour, 10 per user/hour)
- [ ] Email delivery failure handling and retry logic works
- [ ] Email format validation works correctly

#### Access Control

- [ ] Collaborator removal disconnects active WebSocket connections
- [ ] Role change (editor ↔ viewer) works correctly
- [ ] Viewer role cannot send update messages (READ_ONLY_ACCESS error)
- [ ] Viewers can receive real-time updates but cannot edit
- [ ] Document deletion disconnects all collaborators and expires invitations
- [ ] User account deletion cascades correctly (invitations, collaborations)
- [ ] Role change during active session enforces new permissions immediately

#### Connection Management

- [ ] JWT expiration during active collaboration handled gracefully
- [ ] Multiple device connections work correctly (same user, different devices)
- [ ] Connection limits enforced (10 per user, 100 per document)
- [ ] Logout closes WebSocket connections gracefully

#### AI Operations

- [ ] AI refinement lock works correctly (same as generation lock)
- [ ] Refinement events broadcast to all connected clients
- [ ] Concurrent AI operation prevention (generation + refinement cannot run simultaneously)
- [ ] AI operation permissions enforced (viewers cannot trigger)
- [ ] Export uses Y.js state (not RDS draft_text) during collaboration
- [ ] Export doesn't block editing (multiple exports can run simultaneously)
- [ ] History restore lock works correctly (same as generation/refinement lock)
- [ ] Restore events broadcast to all connected clients
- [ ] Restore permissions enforced (only owner can restore)
- [ ] Restore warning shown when active collaborators exist
- [ ] Y.js state reset on restore (complete document replacement)
- [ ] Restore overwrites collaborative edits correctly

#### Metadata & Templates

- [ ] Document metadata changes broadcast to all clients
- [ ] Template selection doesn't affect active collaboration

#### Snapshot Management

- [ ] Snapshot cleanup runs correctly (keep last 10, delete > 30 days)

---

## Documentation Requirements

- [ ] **Developer Documentation**

  - [ ] WebSocket protocol specification
  - [ ] Y.js integration guide
  - [ ] Connection management patterns
  - [ ] Testing guide

- [ ] **User Documentation**

  - [ ] How to collaborate on documents
  - [ ] Understanding presence indicators
  - [ ] Troubleshooting connection issues
  - [ ] Best practices for collaboration

- [ ] **Operations Documentation**
  - [ ] DynamoDB table management
  - [ ] Connection monitoring
  - [ ] Troubleshooting guide
  - [ ] Scaling considerations

---

## Final Checklist

Before considering the collaboration feature complete:

- [ ] All PRs completed and merged
- [ ] All tests passing (unit, integration, E2E)
- [ ] All documentation updated
- [ ] Monitoring and observability implemented
- [ ] Performance requirements met (< 100ms latency, < 2s sync time)
- [ ] Security requirements met (JWT, encryption, validation)
- [ ] User experience requirements met (clear status, error messages, accessibility)
- [ ] Production deployment ready
- [ ] Rollout plan executed

---

**Last Updated**: January 2025  
**Status**: Ready for Implementation  
**Next Steps**: Begin with PR #21: Production-Ready WebSocket Infrastructure
