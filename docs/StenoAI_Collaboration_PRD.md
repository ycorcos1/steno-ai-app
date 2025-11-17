# StenoAI — Real-Time Collaboration PRD

## 1. Overview

**Project Name:** StenoAI Real-Time Collaboration Enhancement  
**Goal:** Enable real-time collaborative editing to improve user experience and enable multi-user document workflows.

This PRD focuses on building a production-ready real-time collaboration system that allows multiple users to edit documents simultaneously. The system will leverage WebSocket infrastructure and Y.js CRDT technology to create a seamless collaborative editing experience.

---

## 2. Target Users

1. **Attorneys** – Primary users who need to collaborate on demand letters in real-time

   - Multiple attorneys editing the same document simultaneously
   - Seamless editing across multiple devices (desktop, tablet)
   - Real-time visibility of collaborator changes

2. **Paralegals and Legal Assistants** – Secondary users who assist attorneys
   - Edit and collaborate on demand letters in real-time with attorneys
   - Ensure accuracy and completeness through collaborative editing

---

## 3. Objectives

- Enable real-time collaborative editing with conflict-free synchronization
- Support multiple concurrent users on the same document
- Ensure reliable connection handling with auto-reconnection
- Maintain document consistency across all connected clients
- Enable presence awareness (who's viewing/editing)

---

## 4. Functional Requirements

### 4.1 Real-Time Collaboration Infrastructure

#### 4.1.1 WebSocket Connection Management

- **Production-Ready Connection Tracking**

  - Replace in-memory connection storage with DynamoDB
  - Support multiple Lambda instances (stateless architecture)
  - Connection lifecycle management (connect, disconnect, reconnect)
  - Session persistence across reconnects
  - **Connection Limits**:
    - Per user: 10 concurrent WebSocket connections (prevents abuse)
    - Per document: 100 concurrent connections (scalability limit)
    - Error on limit: `{ type: 'error', code: 'CONNECTION_LIMIT_EXCEEDED', message: 'Maximum connections reached' }`
    - User can close old connections via UI or automatic cleanup
  - **Multiple Device Support**:
    - User can have multiple active connections (different devices/tabs)
    - Each connection tracked separately in DynamoDB
    - Presence shows user once (deduplicated by userId)
    - Edits from any device sync to all devices in real-time
    - Connection limit applies per user (not per device)
  - **Connection State Recovery**:
    - DynamoDB connection records persist across Lambda restarts
    - On Lambda restart: connections remain in DynamoDB (TTL handles cleanup)
    - Clients auto-reconnect and resume collaboration
    - No data loss (Y.js state in RDS, operations persisted)
  - **Logout Handling**:
    - Client closes WebSocket connection on logout
    - Server cleans up DynamoDB connection record on `$disconnect`
    - Other users see user leave (presence update broadcast)
    - Graceful disconnection (not treated as error)
    - All user's connections closed across all documents

- **Connection Protocol**

  - JWT authentication via query parameter on `$connect`
  - Connection ID mapping to user ID and document ID
  - Automatic cleanup of stale connections via TTL (1 hour expiration)
  - Connection health monitoring via ping/pong
  - **JWT Expiration During Collaboration**:
    - Server validates JWT on `$connect` only (not on every message)
    - If JWT expires during active session: connection remains open (already authenticated)
    - On reconnection: new JWT required (client should refresh JWT before expiration)
    - Client should proactively refresh JWT to avoid reconnection issues

- **Reconnection Handling**

  - Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s)
  - State synchronization on reconnect using `lastKnownVersion`
  - Conflict resolution for missed updates via Y.js CRDT
  - User notification of connection status

- **Connection Health Monitoring (Heartbeat)**

  - Server sends `{ type: 'ping' }` every 30 seconds to all active connections
  - Client must respond with `{ action: 'pong' }` within 10 seconds
  - After 3 consecutive missed pongs, server closes connection gracefully
  - Prevents stale connections lingering in DynamoDB before TTL expiration
  - Client sends `{ action: 'ping' }` if no activity for 45 seconds (keepalive)

#### 4.1.2 Reconnection Scenarios (Detailed)

**Scenario 1: Clean Reconnect (No Local Edits)**

- Client sends `join` message with `lastKnownVersion`
- Server queries DynamoDB for active connections
- Server sends ops since that version from `doc_ops` table
- Client applies updates and continues editing
- **Expected Time**: < 2 seconds

**Scenario 2: Reconnect with Local Edits**

- Client maintains local Y.js document state during disconnect
- On reconnect, client sends its pending local operations
- Server merges using Y.js CRDT (conflict-free merge)
- Server broadcasts merged state to all clients
- **Expected Time**: < 3 seconds

**Scenario 3: Long Disconnect (> 1 hour)**

- Server TTL expired connection record in DynamoDB
- Treat as fresh connection (full snapshot sync)
- Client's local edits are lost (trade-off for simplicity)
- Show warning: "You were disconnected for too long. Your local changes may have been lost."
- **Expected Time**: < 5 seconds

**Error Handling**:

- Max 5 reconnect attempts with exponential backoff
- After 5 failures, show "Cannot connect" error with manual retry button
- Log connection failures to CloudWatch for debugging
- User can manually refresh page to force reconnection

#### 4.1.2 Y.js CRDT Integration

- **Document Synchronization**

  - Y.js document structure for draft text
  - Automatic conflict resolution via CRDT (Conflict-free Replicated Data Type)
  - Operation persistence in database
  - Snapshot-based sync for quick initialization

- **Conflict Resolution**

  - **CRDT Properties**: Y.js ensures conflict-free merging of concurrent edits
  - **Deterministic Merging**: Operations can be applied in any order with consistent results
  - **No Data Loss**: All concurrent edits are preserved and merged automatically
  - **No Central Authority**: No server-side conflict resolution logic needed
  - **Example**: User A types "Hello" and User B types "World" at the same position → Result: "HelloWorld" or "WorldHello" (deterministic based on operation timestamps)

- **Update Broadcasting**

  - Real-time broadcast of Y.js updates to all connected clients
  - Efficient delta compression for large documents
  - Batch small operations together
  - Operation ordering and consistency

- **State Persistence**
  - Periodic snapshots (every ~100 ops or 5 minutes)
  - Incremental operation log (`doc_ops` table)
  - Snapshot versioning for rollback capability
  - Efficient replay mechanism

### 4.2 AI Generation Integration

**Note**: Progressive AI generation features (streaming, chunk-by-chunk progress) are covered in the Performance PRD. This section focuses on how AI generation integrates with real-time collaboration.

#### 4.2.1 AI Generation During Collaboration

**Problem**: AI generation directly updates `draft_text` in RDS while Y.js manages draft content in memory via CRDT. These systems can conflict when generation occurs during active collaboration.

**Solution: Generation Lock with Backward Compatibility**

- **Document State Management**

  - When generation starts, document enters `"generating"` state
  - All connected users see "AI is generating..." indicator
  - Editing is disabled during generation (UI prevents input)
  - WebSocket broadcasts `generation_started` event to all connected clients

- **Generation Completion with Backward Compatibility**

  - **Check for Active Collaborators**: Use `checkActiveCollaborators(documentId)` to determine if collaboration is active
  - **If Active Collaborators Exist**:
    - On completion, generated draft is applied as single Y.js update
    - Broadcast `generation_complete` event with new draft text to all connected clients
    - Update `draft_text` in RDS (for consistency and auto-save compatibility)
    - Document state returns to `"draft_generated"` or `"draft"`
    - Users can then edit the generated content collaboratively
  - **If No Active Collaborators (Solo Editing)**:
    - Use existing RDS update behavior (backward compatible)
    - Update `draft_text` in RDS directly
    - No WebSocket events needed (no other users to notify)
    - Document state returns to `"draft_generated"` or `"draft"`

- **Error Handling**
  - If generation fails, document state returns to previous state
  - Users notified via WebSocket `generation_error` event (if collaboration active)
  - Editing re-enabled automatically

#### 4.2.2 AI Refinement During Collaboration

**Problem**: AI refinement directly updates `draft_text` in RDS while Y.js manages draft content in memory via CRDT. These systems can conflict when refinement occurs during active collaboration.

**Solution: Refinement Lock with Backward Compatibility** (Same mechanism as generation lock)

- **Document State Management**

  - When refinement starts, document enters `"refining"` state
  - All connected users see "AI is refining draft..." indicator
  - Editing is disabled during refinement (UI prevents input)
  - WebSocket broadcasts `refinement_started` event to all connected clients

- **Refinement Completion with Backward Compatibility**

  - **Check for Active Collaborators**: Use `checkActiveCollaborators(documentId)` to determine if collaboration is active
  - **If Active Collaborators Exist**:
    - On completion, refined draft is applied as single Y.js update
    - Broadcast `refinement_complete` event with new draft text to all connected clients
    - Update `draft_text` in RDS (for consistency and auto-save compatibility)
    - Document state returns to `"draft"` or `"draft_generated"`
    - Users can then edit the refined content collaboratively
  - **If No Active Collaborators (Solo Editing)**:
    - Use existing RDS update behavior (backward compatible)
    - Update `draft_text` in RDS directly
    - No WebSocket events needed (no other users to notify)
    - Document state returns to `"draft"` or `"draft_generated"`

- **Error Handling**
  - If refinement fails, document state returns to previous state
  - Users notified via WebSocket `refinement_error` event (if collaboration active)
  - Editing re-enabled automatically

#### 4.2.3 AI Operation Permissions

- **Who Can Trigger AI Operations**:

  - **Generation**: Owner and editors can trigger (viewers cannot)
  - **Refinement**: Owner and editors can trigger (viewers cannot)
  - **Export**: Owner and editors can export (viewers cannot)
  - **Restore**: Only owner can restore (editors and viewers cannot)
  - Server validates user role before processing AI operation requests
  - Error if viewer attempts: `{ error: 'Read-only access. You cannot trigger AI operations.' }`
  - Error if non-owner attempts restore: `{ error: 'Only document owner can restore previous versions' }`

- **Concurrent AI Operation Prevention**:
  - If generation/refinement/restore already in progress: return error
  - Error: `{ error: 'AI operation already in progress. Please wait for current operation to complete.' }`
  - Document state prevents multiple simultaneous operations
  - Check document status before starting new operation (`"generating"`, `"refining"`, or `"restoring"` blocks new operations)
  - Only one AI operation can run at a time per document

#### 4.2.5 Export During Collaboration

- **Export Behavior with Backward Compatibility**:
  - **Check for Active Collaborators**: Use `checkActiveCollaborators(documentId)` to determine if collaboration is active
  - **If Active Collaborators Exist**:
    - Export uses current Y.js state (not RDS `draft_text`) to capture latest collaborative edits
    - Server reads current Y.js state from connected clients (or reconstructs from snapshot + ops)
    - Converts Y.js text to Word document format
    - Uploads to S3 and returns download link
  - **If No Active Collaborators (Solo Editing)**:
    - Use existing RDS `draft_text` (backward compatible)
    - Read `draft_text` from RDS directly
    - Converts to Word document format
    - Uploads to S3 and returns download link
  - Export is read-only operation (doesn't lock document or prevent editing)
  - Multiple users can export simultaneously (no conflicts)
  - Export reflects latest collaborative edits at time of export (if collaboration active)
  - Other users can continue editing during export (no interruption)

#### 4.2.6 History Restore During Collaboration

**Problem**: Restore operation updates RDS `draft_text` directly while Y.js manages draft content in memory. This can conflict during active collaboration and cause data loss.

**Solution: Restore Lock** (Similar to generation/refinement lock)

- **Restore Permissions**:

  - Only document owner can restore (editors/viewers cannot)
  - Server validates ownership before restore: `documents.owner_id = userId`
  - Error if non-owner attempts: `{ error: 'Only document owner can restore previous versions' }`

- **Restore Process**:

  1. Check if document has active collaborators (query DynamoDB connections)
  2. If active collaborators exist: require confirmation "X users are currently editing. Restoring will overwrite their changes. Continue?"
  3. Set document status to `"restoring"` state
  4. Broadcast `restore_started` event to all connected clients
  5. Disable editing during restore (UI prevents input, shows "Document is being restored...")
  6. Update RDS `draft_text` with restored version
  7. **Y.js State Reset**:
     - Create new Y.js document instance (old state discarded)
     - Apply restored text as complete Y.js update (replaces entire document, not incremental)
     - All operations since restored point are lost
     - New snapshot created from restored state
     - All connected clients receive full document replacement
  8. Broadcast `restore_complete` event with restored text to all connected clients
  9. All connected users see restored version immediately
  10. Editing re-enabled after restore completes
  11. Show warning to collaborators: "Document was restored to a previous version. Your recent edits may have been lost."

- **Restore Conflict Handling**:

  - If active collaborators exist: show warning before restore
  - Warning message: "X users are currently editing. Restoring will overwrite their changes. Continue?"
  - Owner can proceed or cancel
  - If proceed: all collaborative edits since last snapshot are lost
  - Future enhancement: Only allow restore when no active collaborators (optional safety feature)

- **Error Handling**:

  - If restore fails, document state returns to previous state
  - Users notified via WebSocket `restore_error` event
  - Editing re-enabled automatically
  - Error logged with full context for debugging

- **History Viewing During Collaboration**:
  - Viewing refinement history is read-only (doesn't affect collaboration)
  - Multiple users can view history simultaneously
  - History page shows all refinements (including those made during collaboration)
  - Restore action requires owner permission and triggers restore lock

#### 4.2.7 Document Metadata Changes During Collaboration

- **Metadata Changes**:

  - Document title changes: Broadcast `metadata_changed` event to all connected clients
  - Other users see title update in real-time (no page refresh needed)
  - No lock required (metadata changes don't conflict with content edits)
  - Only owner can change document title (editors/viewers cannot)
  - Error if non-owner attempts: `{ error: 'Only document owner can change document title' }`

- **Template Selection**:
  - Template selection is per-generation (not stored in document)
  - Changing template doesn't affect active collaboration
  - Template used for next generation only
  - No WebSocket events needed for template changes
  - Template changes are local to user's session

#### 4.2.4 State Synchronization (Y.js vs RDS)

- **State Management Strategy**:
  - **During Active Collaboration**: Y.js is source of truth (in-memory CRDT state)
  - **On Document Load**: Y.js initialized from RDS `draft_text` (authoritative source)
  - **On Snapshot Creation**: Y.js state saved to RDS `draft_text` (periodic sync)
  - **After AI Operations**: Both Y.js and RDS updated atomically (generation/refinement)
  - **State Reconciliation**:
    - On document load: Y.js initialized from RDS (RDS is authoritative)
    - During collaboration: Y.js is source of truth (most recent edits)
    - On snapshot: Y.js state saved to RDS (sync point)
    - Conflict resolution: Y.js state always wins (most recent collaborative edits)

#### 4.2.8 Auto-Save During Collaboration

- **Auto-Save Behavior**:

  - Auto-save continues to work during collaboration (every 2 seconds)
  - **During Collaboration**: Auto-save extracts text from Y.js state and saves to RDS `draft_text`
  - **During Solo Editing**: Auto-save uses existing behavior (saves React state to RDS)
  - This ensures RDS `draft_text` stays synchronized with Y.js state
  - Auto-save is non-blocking and doesn't interfere with real-time collaboration

- **Implementation**:
  - Check `activeUsers.size > 1` to determine if collaboration is active
  - If active: Extract text from `yjsRef.current.ytext.toString()` and save to RDS
  - If inactive: Use existing auto-save logic (save `draftText` state)
  - Auto-save endpoint (`PUT /documents/:id/draft`) remains unchanged

### 4.3 Presence & Awareness

#### 4.3.1 User Presence

- **Active User Display**

  - List of users currently viewing/editing document
  - User avatars and names
  - Connection status (online, typing, idle)
  - Last activity timestamp

- **Presence Indicators**
  - Visual indicators in editor (user list sidebar)
  - Color-coded cursors (future enhancement)
  - "User is typing..." indicators
  - Join/leave notifications

#### 4.3.2 Document Access Control

- **Collaboration Permissions**

  - Document owner can invite collaborators
  - Role-based access: `owner`, `editor`, `viewer`
  - Permission management UI
  - Access validation on WebSocket join

- **Access Validation on Join**

  - Check `documents.owner_id` OR `document_collaborators.user_id`
  - Verify user has `editor` or `viewer` role (viewers can read-only)
  - Reject connection with 403 if access denied
  - Log access attempts for security auditing

- **Viewer Role Behavior**

  - Viewers can connect via WebSocket and receive real-time updates
  - Viewers can see all edits as they happen (read-only sync)
  - Viewers cannot send `update` messages (server rejects with `{ type: 'error', code: 'READ_ONLY_ACCESS' }`)
  - Viewers see presence indicators and active collaborators
  - UI disables editing controls for viewers (input fields disabled, visual indicator shows "Read-only")
  - Viewers receive all broadcast updates but cannot modify document content

- **Role Modification**

  - Owner can change collaborator role (editor ↔ viewer)
  - API endpoint: `PATCH /documents/:id/collaborators/:userId` with `{ role: 'editor' | 'viewer' }`
  - If changed to viewer: disconnect active WebSocket if user is currently editing
  - Broadcast role change notification to affected user: `{ type: 'role_changed', newRole: 'viewer' | 'editor' }`
  - UI updates to reflect new permissions immediately
  - If changed from viewer to editor: user can immediately start editing
  - **Role Change During Active Session**:
    - Server immediately enforces new role (check on next message)
    - Pending edits are broadcast (already sent, cannot be revoked)
    - Future edits rejected with READ_ONLY_ACCESS error
    - UI updates to show read-only mode
    - User receives `role_changed` WebSocket event with new role

- **Permission Change Propagation**

  - When user is removed as collaborator, disconnect their active connections
  - Broadcast `access_revoked` event to affected users
  - Show notification: "You no longer have access to this document"
  - Gracefully close WebSocket connection

- **Document Deletion Handling**

  - If document is deleted while collaborators are active:
    - Server broadcasts `document_deleted` event to all connected clients
    - All WebSocket connections for that document closed gracefully
    - Clients show notification: "This document has been deleted"
    - Redirect users to Dashboard
    - Pending invitations for deleted document automatically marked as `'expired'`
    - All `document_collaborators` records cascade deleted (via database foreign key)

- **User Account Deletion Handling**

  - If inviter account deleted: all pending invitations they sent are cancelled (CASCADE deletes invitation records)
  - If invitee account deleted: `invitee_user_id` set to NULL, but `invitee_email` remains in invitation record
  - If user accepts invitation after account recreation: new `invitee_user_id` populated on acceptance
  - Active collaborations: `document_collaborators` records deleted (CASCADE)
  - WebSocket connections: closed and cleaned up on user deletion
  - Documents owned by deleted user: cascade deleted (CASCADE on `documents.owner_id`)

#### 4.3.3 Invitation System

- **Invitation Creation**

  - Document owner can invite collaborators by email address
  - Owner selects role: `editor` (can edit) or `viewer` (read-only)
  - System generates secure token (cryptographically random) and sets expiration (7 days)
  - Invitation link shared via in-app notification and shareable URL
  - Pending invitations visible in Editor share modal
  - Unique constraint prevents duplicate pending invitations for same email/document
  - **Inviting Existing Collaborator**:
    - If user already has access: return error `{ error: 'User is already a collaborator' }`
    - If owner wants to change role: use `PATCH /documents/:id/collaborators/:userId` instead
    - If previous invitation was declined/expired: new invitation allowed (creates new record)
  - **Invitation Rate Limiting**:
    - Limit: 50 invitations per document per hour (owner)
    - Limit: 10 invitations per user per hour (across all documents)
    - Error: `{ error: 'RATE_LIMIT_EXCEEDED', retryAfter: 3600 }`
    - Rate limits reset after time window expires

- **Invitation Acceptance Flow**

  - Public route: `/invitations/accept/:token` (works for logged-in and logged-out users)
  - If user is not logged in:
    - Show invitation details (document title, inviter name, role)
    - Display "Sign Up" or "Log In" buttons
    - After authentication, redirect back to acceptance page
  - If user is logged in:
    - Validate token and expiration date
    - Show invitation details with "Accept" or "Decline" buttons
  - **Email Validation**:
    - If logged-in user's email matches invitation `invitee_email`: allow acceptance
    - If email doesn't match: show error "This invitation was sent to {invitee_email}. Please log in with that email address."
    - Provide option to log out and log in with correct email
  - **Email Format Validation**:
    - Accept any valid email format (RFC 5322 compliant)
    - No domain whitelist/blacklist (allows external collaborators)
    - Email format validation on invitation creation
    - Invalid email format error: `{ error: 'Invalid email format' }`
  - **Concurrent Acceptance Prevention**:
    - Use database transaction with row-level lock on invitation record
    - Check status before updating: if already `accepted`, return error
    - Error: `{ error: 'This invitation has already been accepted' }`
    - Prevent duplicate `document_collaborators` records (unique constraint on `document_id, user_id`)
  - **Invalid Token Error Messages**:
    - Expired token: "This invitation has expired. Please request a new invitation."
    - Cancelled token: "This invitation has been cancelled."
    - Already accepted: "This invitation has already been accepted."
    - Invalid token format: "Invalid invitation link."
    - Token not found: "Invitation not found. The link may be invalid or expired."
  - On Accept:
    - API creates `document_collaborators` record with specified role (within transaction)
    - Updates invitation status to `'accepted'` (atomic operation)
    - Sets `accepted_at` timestamp
    - Owner receives in-app notification
    - Notification includes: invitee name, document title, accepted timestamp
    - Redirects user to `/documents/:id` (document editor)
    - User can immediately access document and start collaborating
  - On Decline:
    - Updates invitation status to `'declined'`
    - Sets `declined_at` timestamp
    - Shows confirmation message: "Invitation declined"

- **Invitation Management**

  - Dedicated `/invitations` page for viewing all pending invitations for current user
  - Dashboard shows invitation count badge/notification
  - Invitations automatically expire after 7 days (status set to `'expired'`)
  - Owner can view pending invitations in Editor share modal
  - **Resend Invitation**:
    - Owner can resend pending invitation
    - Creates new token (old token becomes invalid)
    - Updates `expires_at` to 7 days from resend date
    - Shows new shareable invitation link in UI
    - Old invitation record updated (token replaced, expiration extended)
  - **Cancel Invitation**:
    - Owner can cancel pending invitation
    - Updates invitation status to `'cancelled'`
    - Sets `cancelled_at` timestamp
    - If user tries to accept cancelled invitation: show error "This invitation has been cancelled"
  - Invitation history visible to owner (accepted, declined, expired, cancelled)

- **Invitation Status Transitions**

  - **Status Flow**:
    - `pending` → `accepted` (via accept endpoint)
    - `pending` → `declined` (via decline endpoint)
    - `pending` → `expired` (automatic after 7 days)
    - `pending` → `cancelled` (via owner cancellation)
    - Once `accepted`, `declined`, `expired`, or `cancelled`: status cannot change
  - Status is immutable after terminal state (no re-activation of expired/cancelled invitations)
  - **Expiration Cleanup Mechanism**:
    - Option A (Recommended for Production): Scheduled Lambda (EventBridge) runs daily to mark expired invitations
      - Query invitations where `expires_at < NOW()` AND `status = 'pending'`
      - Update status to `'expired'` in batch
    - Option B (MVP Simplicity): On-demand check when user tries to accept
      - Check `expires_at` on acceptance attempt
      - Mark as expired if past expiration date
      - Note: Expired invitations remain in database until accessed

- **Database Schema**

  - `invitations` table tracks all invitation states
  - Unique constraint on `(document_id, invitee_email, status)` where `status = 'pending'` prevents duplicate pending invitations
  - Token-based authentication for acceptance links (secure, non-guessable)
  - Automatic expiration handling via `expires_at` timestamp
  - Indexes on `invitee_email`, `invitee_user_id`, `token`, and `status` for efficient queries
  - **Token Security**:
    - Tokens are single-use (invalidated after acceptance)
    - Tokens expire after 7 days (automatic)
    - Tokens are URL-safe Base64 encoded (cryptographically random, 32+ bytes)
    - Tokens stored as UNIQUE in database (prevents collisions)
    - Optional: Consider adding HMAC signature for additional validation (future enhancement)

- **API Endpoints**

  - `POST /documents/:id/invitations` - Create invitation (owner only)
  - `GET /invitations` - Get all pending invitations for current user
  - `GET /invitations/:token` - Get invitation details by token (for acceptance page)
  - `POST /invitations/:token/accept` - Accept invitation
  - `POST /invitations/:token/decline` - Decline invitation
  - `GET /documents/:id/collaborators` - List all collaborators (owner only)
  - `DELETE /documents/:id/collaborators/:userId` - Remove collaborator (owner only)
  - `PATCH /documents/:id/collaborators/:userId` - Change collaborator role (owner only)
  - `POST /documents/:id/invitations/:invitationId/resend` - Resend invitation (owner only)
  - `POST /documents/:id/invitations/:invitationId/cancel` - Cancel invitation (owner only)

- **UI Components**

  - **Share Modal in Editor** (`/documents/:id`):
    - "Share Document" button in toolbar
    - Modal displays:
      - Current collaborators list (owner + editors/viewers with names/emails)
      - Invite form (email input + role selector dropdown)
      - Pending invitations list (with resend/cancel actions)
      - Remove collaborator action (owner only, with confirmation)
  - **Invitations Page** (`/invitations`):
    - Lists all pending invitations for logged-in user
    - Shows document title, inviter name, role, expiration date
    - Accept/Decline buttons for each invitation
    - Link to document after acceptance
  - **Acceptance Page** (`/invitations/accept/:token`):
    - Public route (works without authentication)
    - Displays invitation details
    - Accept/Decline buttons (if logged in)
    - Sign Up/Log In prompts (if not logged in)
    - Handles token validation and expiration
  - **Dashboard Enhancement**:
    - Badge showing pending invitation count
    - Quick access link to `/invitations` page
    - Optional: Recent invitations list widget

### 4.4 UI/UX Enhancements

#### 4.4.1 Connection Status

- **Visual Indicators**

  - Connection status badge (connected/disconnected/reconnecting)
  - Network quality indicator (green/yellow/red based on latency)
  - Reconnection progress feedback with countdown
  - User-friendly error messages for connection failures

- **Error Messages** (user-friendly, non-technical)
  - ✅ Connected: "Connected to real-time collaboration"
  - ⚠️ Reconnecting: "Connection lost. Reconnecting... (Attempt 2 of 5)"
  - ❌ Disconnected: "Unable to connect. Click to retry or refresh the page."
  - 🔒 Access Denied: "You no longer have access to this document"
  - ⏱️ Generating: "AI is generating draft. Editing will be re-enabled shortly."
  - ⏱️ Refining: "AI is refining draft. Editing will be re-enabled shortly."
  - ⏱️ Restoring: "Document is being restored to a previous version. Editing will be re-enabled shortly."
  - 👥 Collaboration: "Another user is editing. Changes will sync automatically."
  - ⚠️ Restore Warning: "Document was restored to a previous version. Your recent edits may have been lost."

#### 4.4.2 Collaboration Feedback

- **Sync Status**

  - Indicator showing sync state (synced, syncing)
  - Last sync timestamp
  - Visual feedback when changes are being applied

- **Presence Feedback**
  - Loading spinner during initial connection
  - Status text ("Connecting...", "Syncing document...")
  - Success/error notifications for connection events

#### 4.4.3 Collaboration UI

- **Active Users Sidebar**

  - Collapsible sidebar showing active users
  - User avatars and names
  - Connection status per user
  - Click to view user profile (future)

- **Document Sync Status**
  - Indicator showing sync state (synced, syncing, conflict)
  - Last sync timestamp
  - Manual sync trigger button

---

## 5. Technical Architecture

### 5.1 WebSocket Infrastructure

#### 5.1.1 AWS API Gateway WebSocket API

- **Routes**

  - `$connect` – Authenticate and establish connection
  - `$disconnect` – Cleanup connection and notify peers
  - `$default` – Handle all application messages

- **Viewer Role Enforcement**

  - Server checks user role before processing `update` messages
  - If user has `viewer` role: reject `update` message with `{ type: 'error', code: 'READ_ONLY_ACCESS', message: 'You have read-only access to this document' }`
  - Server still broadcasts updates TO viewers (they receive but cannot send)
  - Viewers can send `join`, `presence`, `ping`, `pong` messages (read-only operations)
  - Viewers cannot send `update` or `create_snapshot` messages

- **Message Protocol**

  ```typescript
  // Client → Server
  {
    action: "join" | "update" | "presence" | "create_snapshot",
    documentId: string,
    update?: string, // base64 Y.js update
    cursor?: { line: number, column: number },
    // ... other fields
  }

  // Server → Client
  {
    type: "sync" | "update" | "presence" | "generation_started" | "generation_complete" | "generation_error" | "refinement_started" | "refinement_complete" | "refinement_error" | "restore_started" | "restore_complete" | "restore_error" | "metadata_changed" | "error" | "role_changed" | "document_deleted" | "access_revoked",
    snapshot?: string, // base64 Y.js snapshot
    ops?: string[], // base64 Y.js operations
    update?: string, // base64 Y.js update
    userId?: string,
    newRole?: "editor" | "viewer", // for role_changed events
    code?: string, // error code (e.g., "READ_ONLY_ACCESS", "MESSAGE_TOO_LARGE")
    message?: string, // error or notification message
    metadata?: { title?: string }, // for metadata_changed events
    // ... other fields
  }
  ```

#### 5.1.2 Connection Storage (DynamoDB)

**Why DynamoDB + RDS?**

- **RDS (PostgreSQL)**: Structured document data, Y.js snapshots/operations, user accounts, complex queries
- **DynamoDB**: Real-time connection state (requires < 10ms latency, high write throughput, stateless Lambda support)

#### 5.1.3 Message Validation & Security

**Purpose**: Prevent malicious input, ensure system stability, and provide clear error feedback during collaboration.

**Input Validation Rules**:

```typescript
interface WebSocketMessageValidation {
  maxMessageSize: 1048576; // 1MB total message size
  maxUpdateSize: 1048576; // 1MB for Y.js update (Base64)
  maxDocumentIdLength: 36; // UUID format
  maxActionLength: 50; // Action string length
  allowedActions: [
    "join",
    "update",
    "presence",
    "create_snapshot",
    "leave",
    "ping",
    "pong"
  ];
}
```

**Validation Checks** (performed before message processing):

1. **Message Size**: Reject messages > 1MB

   - Error: `{ type: 'error', code: 'MESSAGE_TOO_LARGE', maxSize: 1048576 }`

2. **Action Validation**: Only allow whitelisted actions

   - Error: `{ type: 'error', code: 'INVALID_ACTION', allowedActions: [...] }`

3. **Document ID Format**: Must be valid UUID

   - Error: `{ type: 'error', code: 'INVALID_DOCUMENT_ID' }`

4. **Base64 Validation**: Ensure Y.js updates are valid Base64
   - Error: `{ type: 'error', code: 'INVALID_ENCODING' }`

**Rate Limiting** (in-memory per Lambda instance):

```typescript
interface RateLimits {
  updateMessages: 100; // per connection per second
  presenceUpdates: 10; // per connection per second
  snapshotRequests: 1; // per document per minute
  joinAttempts: 5; // per user per minute
}
```

**Rate Limit Implementation**:

```typescript
// Simple token bucket algorithm
const rateLimiters = new Map<
  string,
  {
    tokens: number;
    lastRefill: number;
    limit: number;
    refillRate: number;
  }
>();

function checkRateLimit(connectionId: string, action: string): boolean {
  const limiter = rateLimiters.get(`${connectionId}:${action}`) || {
    tokens: getLimit(action),
    lastRefill: Date.now(),
    limit: getLimit(action),
    refillRate: 1000, // 1 second
  };

  // Refill tokens based on time elapsed
  const now = Date.now();
  const timePassed = now - limiter.lastRefill;
  const tokensToAdd =
    Math.floor(timePassed / limiter.refillRate) * limiter.limit;
  limiter.tokens = Math.min(limiter.limit, limiter.tokens + tokensToAdd);
  limiter.lastRefill = now;

  if (limiter.tokens > 0) {
    limiter.tokens--;
    rateLimiters.set(`${connectionId}:${action}`, limiter);
    return true;
  }

  return false;
}
```

**Error Response**:

- `{ type: 'error', code: 'RATE_LIMIT_EXCEEDED', retryAfter: 1000 }`

**Security Headers** (WebSocket handshake):

- Validate Origin header matches allowed domains
- Enforce WSS (encrypted) connections only
- Validate JWT signature and expiration before `$connect`

**Sanitization**:

- All string inputs trimmed and length-validated
- No script tags or HTML allowed in presence metadata
- Document IDs validated against UUID regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`

**Table: `stenoai-{env}-connections`**

**Schema**:

```
- connectionId (String, Partition Key)
- userId (String, GSI1PK)
- documentId (String, GSI2PK)
- connectedAt (Number, Unix timestamp)
- lastActivityAt (Number, Unix timestamp)
- ttl (Number, Unix timestamp for TTL - 1 hour expiration)
```

**Global Secondary Indexes**:

- `userId-index`: Query all connections for a user (for presence)
- `documentId-index`: Query all connections for a document (for broadcasting)

**Provisioned Throughput**: 5 read/write units (on-demand pricing available)

**TTL**: Enabled on `ttl` attribute - automatically deletes stale connections after 1 hour

**Table: `stenoai-{env}-document-rooms`**

**Schema**:

```
- documentId (String, Partition Key)
- activeUsers (List of userIds)
- lastActivityAt (Number, Unix timestamp)
```

**Purpose**: Optional table for presence aggregation and room management. Can be derived from connections table but useful for quick lookups.

**Provisioned Throughput**: 5 read/write units

**Access Patterns**:

1. Save connection on `$connect`: `PutItem` to connections table
2. Update document on `join`: `UpdateItem` to set documentId
3. Broadcast to room: `Query` documentId-index to get all connections
4. Cleanup on disconnect: `DeleteItem` from connections table
5. TTL cleanup: Automatic via DynamoDB TTL feature

### 5.2 Y.js Integration

#### 5.2.0 Helper Functions

**`checkActiveCollaborators(documentId: string): Promise<boolean>`**

- **Purpose**: Determine if a document has active collaborators (for backward compatibility)
- **Implementation**:
  - Query DynamoDB `documentId-index` GSI for active connections
  - Return `true` if any active connections exist, `false` otherwise
  - Used by AI operations (generate, refine, export) to choose between Y.js updates vs RDS updates
- **Location**: `apps/api/src/realtime/persist.ts` or `apps/api/src/lib/collaboration.ts`
- **Usage**:
  - AI generation: Check before choosing Y.js update vs RDS update
  - AI refinement: Check before choosing Y.js update vs RDS update
  - Export: Check before choosing Y.js state vs RDS `draft_text`
  - Restore: Check before showing warning to owner

#### 5.2.1 Document Structure

```typescript
{
  draft: Y.Text, // Main draft content
  metadata: Y.Map, // Document metadata (title, status, etc.)
  // Future: comments, annotations, etc.
}
```

#### 5.2.3 Sync Strategy

1. **Initial Sync**

   - Client sends `join` message with `documentId`
   - Server validates access via `checkDocumentAccess()` (checks owner OR collaborator)
   - **Data Migration & Backward Compatibility**:
     - Existing documents: Y.js initialized from RDS `draft_text` on first collaborative open
     - No data migration required (on-demand initialization)
     - Old documents work seamlessly with collaboration enabled
     - Snapshot created on first collaborative edit (after 100 ops or 5 minutes)
     - Documents without snapshots: full sync from RDS `draft_text`
   - Server loads latest snapshot from `doc_snapshots` table (if exists)
   - Server queries `doc_ops` table for all ops since snapshot version
   - If no snapshot exists: server uses RDS `draft_text` as initial state
   - Server sends snapshot (base64) + ops array (base64[]) to client
   - Client applies snapshot first, then replays all ops in order
   - Client sets `isSynced = true` and emits `synced` event

2. **Incremental Updates**

   - Client sends Y.js updates as user types (throttled to max 10 updates/second)
   - Server validates user is joined to document (check DynamoDB connection)
   - Server persists operation to `doc_ops` table with `session_id = connectionId`
   - Server queries DynamoDB `documentId-index` to get all active connections
   - Server broadcasts update to all other connections (exclude sender)
   - Server checks if snapshot needed (100 ops or 5 minutes)
   - If snapshot needed, server sends `snapshot_needed` event to clients
   - **Message Ordering Guarantees**:
     - Y.js operations are idempotent and order-independent (CRDT property)
     - Server processes messages in order received (per connection)
     - Client applies updates in order received from server
     - Y.js merges operations deterministically regardless of delivery order
     - Out-of-order messages are handled gracefully by CRDT merge algorithm

3. **Reconnection**
   - Client reconnects and sends `join` message with `lastKnownVersion` (optional)
   - Server validates access and loads latest snapshot
   - If `lastKnownVersion` provided, server sends ops since that version
   - Otherwise, server sends latest snapshot + all ops since snapshot
   - Client applies updates and continues editing
   - Client updates `lastKnownVersion` for future reconnects

#### 5.2.4 Snapshot Creation Protocol

**Problem**: Multiple clients might try to create snapshots simultaneously, causing conflicts.

**Solution: Server-Coordinated Snapshots**

1. **Snapshot Trigger**

   - Server detects snapshot needed: `countOpsSinceLastSnapshot() >= 100` OR `timeSinceSnapshot >= 5 minutes`
   - Server sets document state to "snapshotting" (prevents new snapshot attempts)

2. **Snapshot Creation Flow**

   - Server broadcasts `snapshot_needed` event to all connected clients
   - First client to respond sends `create_snapshot` action with Y.js state (base64)
   - Server validates snapshot and saves to `doc_snapshots` table with incremented version
   - Server updates `lastSnapshotTime` in memory (per Lambda instance)
   - Server broadcasts `snapshot_created` event with new version number
   - Server clears "snapshotting" flag

3. **Fallback for No Connected Clients**

   - If no clients respond within 30 seconds, server reconstructs Y.js state
   - Server loads latest snapshot + all ops since snapshot
   - Server applies ops to reconstruct current state
   - Server creates new snapshot from reconstructed state
   - More expensive but ensures data integrity

4. **Snapshot Versioning**
   - Each snapshot has incremental `version` number per document
   - Version stored in `doc_snapshots.version` column
   - Clients track `lastKnownVersion` for efficient reconnection sync
   - Old snapshots can be archived (keep last 10 versions)
   - **Snapshot Cleanup Strategy**:
     - Keep last 10 snapshots per document (automatic cleanup)
     - Delete snapshots older than 30 days
     - Scheduled Lambda (EventBridge) runs weekly to clean old snapshots
     - Archive old `doc_ops` records older than 90 days (optional, for storage optimization)
     - Cleanup preserves data integrity (snapshots + ops can reconstruct any state)
   - **Cleanup Failure Handling**:
     - CloudWatch alarm on cleanup Lambda failures
     - Manual cleanup script as backup (`scripts/cleanup_old_snapshots.sh`)
     - Old snapshots don't break functionality (just storage cost)
     - Cleanup is idempotent (safe to re-run)
     - Log cleanup operations for audit trail

#### 5.2.5 Y.js Origin Tracking

**Problem**: Y.js update listener must distinguish between local edits and server syncs to prevent update loops.

**Solution: Proper Origin Tracking**

```typescript
// In yjs.ts handleMessage()
if (type === "update") {
  const updateBuffer = Uint8Array.from(atob(update), (c) => c.charCodeAt(0));
  // Pass provider as origin to prevent echo back to server
  Y.applyUpdate(this.doc, updateBuffer, this); // 'this' is the provider
}

// In ydoc.on("update")
ydoc.on("update", (update: Uint8Array, origin: any) => {
  // Only send if update originated from local user (origin is null/undefined for local edits)
  // Do NOT send if origin is the provider (server update)
  if (origin !== provider && !origin) {
    provider.sendUpdate(update);
  }
});
```

**Why This Matters**:

- Prevents infinite update loops (client → server → client → server)
- Ensures only local user edits are sent to server
- Server updates are applied without echo

### 5.3 AI Generation Integration

**Note**: Progressive generation features (streaming, chunk-by-chunk progress) are covered in the Performance PRD. This section describes how AI generation integrates with the collaboration system.

#### 5.3.1 Generation Flow with Collaboration

1. **Client initiates generation**

   - POST `/documents/generate` (existing endpoint)
   - Server validates and starts generation process
   - Server sets document status to `"generating"` in RDS
   - Server broadcasts `generation_started` event to all connected clients via WebSocket

2. **Generation completion**

   - Server sends `generation_complete` event with full draft text
   - Server updates `draft_text` in RDS
   - Server applies generated text as Y.js update to all connected clients
   - Server sets document status back to `"draft_generated"`
   - Client updates full draft text via Y.js
   - Client shows success notification
   - Editing re-enabled for all connected users

3. **Error handling**
   - If generation fails, server sends `generation_error` event
   - Document state returns to previous state
   - Editing re-enabled automatically

#### 5.3.2 Refinement Flow with Collaboration

1. **Client initiates refinement**

   - POST `/ai/refine` (existing endpoint)
   - Server validates user role (owner or editor only)
   - Server checks document status (must not be `"generating"` or `"refining"`)
   - Server validates and starts refinement process
   - Server sets document status to `"refining"` in RDS
   - Server broadcasts `refinement_started` event to all connected clients via WebSocket

2. **Refinement completion**

   - Server sends `refinement_complete` event with full refined text
   - Server updates `draft_text` in RDS
   - Server applies refined text as Y.js update to all connected clients
   - Server sets document status back to `"draft"` or `"draft_generated"`
   - Client updates full draft text via Y.js
   - Client shows success notification
   - Editing re-enabled for all connected users

3. **Error handling**
   - If refinement fails, server sends `refinement_error` event
   - Document state returns to previous state
   - Editing re-enabled automatically

#### 5.3.3 Restore Flow with Collaboration

1. **Client initiates restore**

   - POST `/documents/:id/restore` with `{ refinementId: string }`
   - Server validates user is owner (only owner can restore)
   - Server checks for active collaborators (query DynamoDB)
   - If active collaborators exist: return warning requiring confirmation
   - Server checks document status (must not be `"generating"`, `"refining"`, or `"restoring"`)
   - Server sets document status to `"restoring"` in RDS
   - Server broadcasts `restore_started` event to all connected clients via WebSocket

2. **Restore completion**

   - Server loads restored text from `refinements` table
   - Server updates `draft_text` in RDS
   - Server creates new Y.js document instance (discards old state)
   - Server applies restored text as complete Y.js update (full replacement)
   - Server creates new snapshot from restored state
   - Server sends `restore_complete` event with restored text to all connected clients
   - Server sets document status back to `"draft"` or `"draft_generated"`
   - Client replaces entire Y.js document with restored version
   - Client shows success notification
   - Client shows warning: "Document was restored. Recent edits may have been lost."
   - Editing re-enabled for all connected users

3. **Error handling**
   - If restore fails, server sends `restore_error` event
   - Document state returns to previous state
   - Editing re-enabled automatically

### 5.4 Database Schema Updates

#### 5.4.1 New Tables

**DynamoDB Tables** (see Section 5.1.2 for detailed schemas)

- `stenoai-{env}-connections` - WebSocket connection tracking
- `stenoai-{env}-document-rooms` - Document room management (optional)

**PostgreSQL Tables**

**`invitations`** (PostgreSQL - Required for collaboration)

- Tracks document collaboration invitations
- Supports email-based invitation flow with token authentication
- Links to document, inviter, and invitee (by email or user_id)
- Schema:

  ```sql
  CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_email VARCHAR(255) NOT NULL,
    invitee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'editor', -- 'editor' or 'viewer'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'expired', 'cancelled'
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    declined_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    CONSTRAINT unique_pending_invitation UNIQUE(document_id, invitee_email)
      WHERE status = 'pending'
  );

  CREATE INDEX idx_invitations_invitee_email ON invitations(invitee_email);
  CREATE INDEX idx_invitations_invitee_user_id ON invitations(invitee_user_id);
  CREATE INDEX idx_invitations_token ON invitations(token);
  CREATE INDEX idx_invitations_status ON invitations(status);
  CREATE INDEX idx_invitations_document_id ON invitations(document_id);
  ```

**`generation_sessions`** (PostgreSQL - Optional, for advanced features)

- Tracks active generation operations
- Allows cancellation and progress tracking
- Links to document and user
- Schema:
  ```sql
  CREATE TABLE generation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(50) NOT NULL, -- 'processing', 'completed', 'failed', 'cancelled'
    total_chunks INTEGER,
    completed_chunks INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

#### 5.4.2 Enhanced Existing Tables

**`doc_snapshots`** (already exists in `0003_collab.sql`)

- ✅ `version` field already exists (INTEGER)
- ✅ Index on `(document_id, version DESC)` for latest snapshot query
- No changes needed

**`doc_ops`** (already exists in `0003_collab.sql`)

- ✅ `session_id` field already exists (VARCHAR(255))
- ✅ Index on `(document_id, created_at ASC)` for efficient replay
- No changes needed

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**PR #21: Production-Ready WebSocket Infrastructure**

- Create DynamoDB tables (`stenoai-{env}-connections`, `stenoai-{env}-document-rooms`)
- Replace in-memory connection tracking with DynamoDB in `ws_handler.ts`
- Implement connection lifecycle management (save, update, delete)
- Add DynamoDB IAM permissions to Lambda execution role
- Add reconnection handling with exponential backoff
- Connection health monitoring and TTL cleanup
- Update IAM deployment user policy to include `dynamodb:*`

**Deliverables:**

- DynamoDB tables created via `scripts/dynamodb_create.sh`
- DynamoDB IAM policy attached via `scripts/attach_dynamodb_policy.sh`
- Updated `ws_handler.ts` with DynamoDB integration (no in-memory Map)
- Connection cleanup via DynamoDB TTL (automatic, no Lambda needed)
- Updated `infra/iam/stenoai-deploy-policy.json` with DynamoDB permissions
- Updated `infra/api/lambda-dynamodb-policy.json` for Lambda role

**PR #22: Y.js Integration Completion**

- Fix Y.js origin tracking bug (prevent update loops)
- Complete Y.js provider implementation
- Integrate with existing `yjs.ts` provider
- Update Editor.tsx to use Y.js for draft editing
- Implement operation persistence to `doc_ops` table
- Implement snapshot creation protocol (server-coordinated)
- Add `lastKnownVersion` tracking for efficient reconnection

**Deliverables:**

- Updated `yjs.ts` provider with proper origin tracking
- Editor.tsx with Y.js integration (bind Y.Text to editor)
- Operation broadcasting working (no infinite loops)
- Snapshot creation and replay working
- Reconnection with `lastKnownVersion` support

### Phase 2: Progressive Generation (Optional - After Performance PRD)

**Note**: Progressive generation features (PR #23, #24) are separate from core collaboration functionality and will be implemented after the Performance PRD parallel chunk processing is complete. These features enhance the AI generation experience but are not required for real-time collaboration.

**PR #23: Progressive AI Generation** (Post-Performance PRD - Optional)

- Create `realtime/notify.ts` module for WebSocket notifications
- Implement `notifyProgress()` function to broadcast to connected clients
- Update `generate.ts` to send progress events after each chunk completes
- Add progress UI components (progress bar, status messages)
- Implement generation lock (disable editing during generation)
- Apply generated text as Y.js update on completion

**PR #24: Refinement Progress** (Post-Performance PRD - Optional)

- Add progress events for refinement operations
- Update `refine.ts` to send progress
- Refinement progress UI
- Error handling and notifications

### Phase 3: Presence & Awareness (Week 3-4)

**PR #25: User Presence System**

- Implement presence tracking
- Active users list component
- Join/leave notifications
- Connection status indicators

**Deliverables:**

- Presence tracking in `ws_handler.ts`
- ActiveUsersSidebar component
- Connection status indicators
- Presence events and UI updates

**PR #26: Collaboration UI/UX**

- Document sync status indicators
- Reconnection feedback
- Error handling and user notifications
- Polish and accessibility improvements

**Deliverables:**

- Sync status components
- Reconnection UI feedback
- Error boundary improvements
- Accessibility enhancements

### Phase 4: Invitation System (Week 5-6)

**PR #27: Invitation Database & API**

- Create `invitations` table migration (`0007_invitations.sql`)
- Implement invitation CRUD API endpoints:
  - `POST /documents/:id/invitations` - Create invitation
  - `GET /invitations` - List pending invitations for user
  - `GET /invitations/:token` - Get invitation details
  - `POST /invitations/:token/accept` - Accept invitation
  - `POST /invitations/:token/decline` - Decline invitation
  - `POST /documents/:id/invitations/:invitationId/resend` - Resend invitation
  - `POST /documents/:id/invitations/:invitationId/cancel` - Cancel invitation
  - `GET /documents/:id/collaborators` - List collaborators
  - `DELETE /documents/:id/collaborators/:userId` - Remove collaborator
  - `PATCH /documents/:id/collaborators/:userId` - Change collaborator role
- Implement token generation (cryptographically secure)
- Implement expiration handling (7 days)
- Add invitation validation logic
- Integrate with `document_collaborators` table

**Deliverables:**

- Migration file `0007_invitations.sql` with table and indexes
- API route `apps/api/src/routes/collaborators.ts`
- Database helper functions in `apps/api/src/db/pg.ts`
- Token generation utility
- Expiration check middleware

**PR #28: Invitation UI Components**

- Share modal in Editor (`/documents/:id`)
  - "Share Document" button in toolbar
  - Modal with collaborators list, invite form, pending invitations
  - Remove collaborator functionality
  - Change collaborator role (editor ↔ viewer)
  - Resend/cancel pending invitations
  - Copy shareable invitation link
- Invitations page (`/invitations`)
  - List all pending invitations
  - Accept/Decline actions
- Acceptance page (`/invitations/accept/:token`)
  - Public route (works without auth)
  - Invitation details display
  - Accept/Decline buttons
  - Sign Up/Log In prompts for unauthenticated users
- Dashboard enhancement
  - Invitation count badge
  - Link to invitations page
  - In-app notifications for new invitations

**Deliverables:**

- Share modal component
- Invitations page component
- Acceptance page component
- Dashboard invitation badge
- In-app notification system
- Router updates for new routes
- Responsive design for all components

---

## 7. Success Criteria

### 7.1 Functional Requirements

- ✅ Multiple users can edit the same document simultaneously
- ✅ Changes appear in real-time (< 100ms latency)
- ✅ Users see active collaborators in real-time
- ✅ Reconnection works seamlessly with state sync
- ✅ No data loss during network interruptions
- ✅ Conflict-free merging of concurrent edits (CRDT)

### 7.2 Performance Requirements

- **Connection Latency**: < 50ms for WebSocket messages
- **Sync Time**: < 2 seconds for initial document sync
- **Update Broadcast**: < 100ms for typing updates
- **Reconnection Time**: < 3 seconds for full state recovery
- **Presence Updates**: < 200ms for join/leave notifications

### 7.3 Reliability Requirements

- **Connection Uptime**: > 99% success rate
- **Auto-Reconnect**: 100% success within 30 seconds
- **Data Consistency**: 100% (no lost edits)
- **Conflict Resolution**: 100% (CRDT ensures no conflicts)

### 7.4 User Experience Requirements

- Connection status is always visible with color-coded badge
- Reconnection is automatic and transparent (max 5 attempts)
- No user confusion about collaboration state
- Error messages are user-friendly and actionable
- Changes from other users appear in real-time (< 100ms)
- Responsive design works on desktop and tablet

---

## 8. Non-Functional Requirements

### 8.1 Scalability

- Support 100+ concurrent connections per document
- Handle 1000+ concurrent WebSocket connections total
- DynamoDB auto-scaling for connection tables
- Lambda concurrency for WebSocket handlers

### 8.2 Security

- JWT authentication required for all connections
- Document access validation on join
- Encrypted WebSocket connections (WSS)
- Rate limiting on WebSocket messages
- Input validation for all WebSocket payloads

### 8.3 Monitoring & Observability

- **CloudWatch Metrics**:

  - Active connections count (per document, per user, total)
  - WebSocket message latency (p50, p95, p99 percentiles)
  - Error rates by type (connection failures, message errors, access denied)
  - Invitation metrics (sent, accepted, declined, expired rates)
  - Snapshot creation frequency and duration
  - AI operation metrics (generation/refinement start, completion, failure rates)
  - DynamoDB read/write capacity utilization
  - Y.js operation broadcast latency

- **CloudWatch Alarms**:

  - High error rate (> 5% for 5 minutes) - triggers notification
  - Connection failures (> 10% for 5 minutes) - triggers alert
  - DynamoDB throttling events - triggers scaling action
  - High message latency (p95 > 500ms for 5 minutes) - performance alert
  - AI operation failures (> 10% for 10 minutes) - service degradation alert

- **Logging**:

  - All WebSocket events (connect, disconnect, join, update, presence)
  - Access denied attempts with user/document context (security audit trail)
  - AI operation events (generation/refinement start, complete, error)
  - Invitation lifecycle events (create, accept, decline, expire, cancel)
  - Snapshot creation events with timing and size metrics
  - Error logs with full context (userId, documentId, connectionId, error details)

- **Dashboards**:
  - Real-time collaboration dashboard (active users, documents, connections)
  - Performance dashboard (latency, throughput, error rates)
  - Invitation analytics dashboard (acceptance rates, time to accept)
  - System health dashboard (DynamoDB, RDS, Lambda metrics)

### 8.4 Cost Optimization

- DynamoDB on-demand pricing for connection tables
- Efficient Lambda memory allocation
- Connection cleanup to prevent stale connections
- TTL on connection records

---

## 9. Dependencies

### 9.1 External Dependencies

- **AWS API Gateway WebSocket API** – Already configured
- **DynamoDB** – Need to create tables
- **Y.js Library** – Already integrated, needs completion
- **WebSocket Client** – Browser native API

### 9.2 Internal Dependencies

- **Authentication System** – JWT tokens (PR #7, ✅ Complete)
- **Document Access Control** – `document_collaborators` table (PR #6, ✅ Complete)
- **Invitation System** – `invitations` table (needs migration)
- **Database Schema** – `doc_snapshots`, `doc_ops` tables (PR #14, ✅ Complete)
- **AI Generation** – Existing `/documents/generate` endpoint (PR #12, ✅ Complete)

### 9.3 Performance PRD Dependencies

**Note**: Progressive AI generation features (PR #23, #24) depend on parallel chunk processing from the Performance PRD. These features will be implemented after the core real-time collaboration infrastructure is complete.

---

## 10. Open Questions & Future Enhancements

### 10.1 Open Questions

- Should we support offline editing with sync on reconnect? (Future Enhancement)
- Do we need cursor position sharing? (Nice-to-have)
- Should we implement document locking for exclusive editing? (Future Enhancement)
- Do we need conflict resolution UI for edge cases? (CRDT should prevent conflicts)

### 10.2 Future Enhancements

- **Comments & Annotations**

  - Inline comments on document sections
  - @mentions for notifications
  - Comment threads and replies

- **Advanced Presence**

  - Real-time cursor positions
  - Selection highlighting
  - User avatars with colors

- **Activity Feed**

  - Who changed what and when
  - Change history with user attribution
  - Rollback to specific user's changes

- **Document Versioning**

  - Named versions/snapshots
  - Branching for experimental edits
  - Merge tools for conflicting versions

- **Team Features**
  - Shared document templates
  - Team workspaces
  - Document sharing via links
  - **Bulk Invitation**
    - Owner can invite multiple users at once (comma-separated emails)
    - Each email creates separate invitation record
    - Single API call: `POST /documents/:id/invitations/bulk` with `{ emails: string[], role: 'editor' | 'viewer' }`
    - UI supports pasting multiple emails or selecting from user directory
  - **Owner Transfer**
    - Current owner can transfer ownership to collaborator
    - Transfers all permissions and access control
    - Previous owner becomes editor
    - Requires confirmation from both parties (owner initiates, new owner accepts)
    - API endpoint: `POST /documents/:id/transfer-ownership` with `{ newOwnerId: UUID }`
  - **Owner Account Deletion Handling** (Future Enhancement)
    - If owner account is deleted, handle document ownership:
      - Option A: Transfer ownership to first collaborator (if exists) - preserves data
      - Option B: Delete document (current CASCADE behavior) - simpler but loses data
      - Option C: Mark document as "orphaned" and require admin intervention
    - Recommended: Option A for data preservation, with admin override capability

---

## 11. Testing Requirements

### 11.1 Unit Tests

- WebSocket message handling
- Y.js update broadcasting
- Connection lifecycle management
- Presence tracking logic
- Invitation token generation and validation
- Invitation expiration handling

### 11.2 Integration Tests

- Multi-user editing scenarios
- Reconnection and state sync
- Conflict resolution with concurrent edits
- Presence updates
- Invitation creation and acceptance flow
- Invitation resend and cancellation
- Concurrent invitation acceptance (race condition prevention)
- Inviting existing collaborator (error handling)
- Invitation rate limiting enforcement
- Collaborator removal and access revocation
- Role change (editor ↔ viewer)
- Viewer read-only access enforcement
- Invitation expiration and cleanup (scheduled vs on-demand)
- Document deletion during active collaboration
- User account deletion cascading behavior
- Connection limits (per user, per document)
- Multiple device connections (same user)
- AI refinement lock and event broadcasting
- Concurrent AI operation prevention
- AI operation permission enforcement
- Export during active collaboration
- Y.js state synchronization with RDS
- Data migration and backward compatibility
- History restore during collaboration (restore lock)
- Restore permissions and conflict handling
- Document metadata changes during collaboration

### 11.3 E2E Tests

- Two users editing simultaneously
- Conflict resolution with simultaneous edits
- Reconnection during editing
- Presence indicators
- AI generation integration (generation lock and Y.js sync)
- Complete invitation flow: invite → share link → accept → collaborate
- Invitation acceptance for logged-out users (sign up flow)
- Concurrent invitation acceptance prevention
- Invalid token error messages (expired, cancelled, already accepted)
- Inviting existing collaborator error handling
- Invitation resend and cancellation
- Role change workflow (editor ↔ viewer)
- Viewer read-only collaboration (can see edits but cannot edit)
- Collaborator removal and WebSocket disconnection
- Document deletion during active collaboration
- User account deletion and cascading effects
- Multiple device collaboration (same user, different tabs/devices)
- Connection limit enforcement
- JWT expiration during active collaboration
- Message ordering and CRDT merge with out-of-order delivery
- AI refinement during collaboration (lock mechanism)
- Concurrent AI operation prevention
- Export during active collaboration (uses Y.js state)
- Y.js state synchronization with RDS
- Data migration (old documents work with collaboration)
- Logout handling and connection cleanup
- History restore during collaboration (restore lock mechanism)
- Restore permissions (owner only)
- Restore conflict handling (active collaborators warning)
- Y.js state reset on restore (complete replacement)
- Document metadata changes (title updates)
- Template selection (doesn't affect collaboration)

### 11.4 Load Tests

- 100+ concurrent connections
- High-frequency update broadcasting
- Reconnection under load
- DynamoDB performance

---

## 12. Rollout Plan

### 12.1 Phase 1: Internal Testing (Week 1)

- Deploy to dev environment
- Internal team testing
- Fix critical bugs
- Performance baseline

### 12.2 Phase 2: Beta Testing (Week 2-3)

- Limited user beta
- Gather feedback
- Performance optimization
- UI/UX improvements

### 12.3 Phase 3: Gradual Rollout (Week 4)

- Enable for 10% of users
- Monitor metrics
- Fix issues
- Increase to 50%, then 100%

### 12.4 Phase 4: Full Release

- All users enabled
- Documentation updates
- Training materials
- Support resources

---

## 13. Success Metrics

### 13.1 Adoption Metrics

- % of documents with multiple collaborators
- Average collaborators per document
- Daily active collaborative sessions
- User satisfaction with collaboration features
- Invitation acceptance rate
- Average time from invitation to acceptance
- Number of invitations sent per document
- Invitation expiration rate

### 13.2 Performance Metrics

- Average connection latency
- Sync time percentiles (p50, p95, p99)
- Reconnection success rate
- Update broadcast latency (time from edit to other users seeing it)

### 13.3 Reliability Metrics

- Connection uptime percentage
- Data loss incidents (should be 0)
- Conflict resolution failures (should be 0)
- Error rate for WebSocket operations

---

## 14. Documentation Requirements

- **Developer Documentation**

  - WebSocket protocol specification
  - Y.js integration guide
  - Connection management patterns
  - Testing guide

- **User Documentation**

  - How to collaborate on documents
  - Understanding presence indicators
  - Troubleshooting connection issues
  - Best practices for collaboration

- **Operations Documentation**
  - DynamoDB table management
  - Connection monitoring
  - Troubleshooting guide
  - Scaling considerations

---

---

## 15. Critical Implementation Notes

### 15.1 DynamoDB Setup Requirements

**Before starting PR #21**, ensure:

1. **IAM Permissions**:

   - Deployment user (`stenoai-app`) needs `dynamodb:*` in `StenoAIDeployAccess` policy
   - Lambda execution role needs DynamoDB read/write permissions
   - Run `scripts/attach_dynamodb_policy.sh` to attach Lambda permissions

2. **DynamoDB Tables**:

   - Run `scripts/dynamodb_create.sh` to create tables
   - Tables use on-demand pricing (pay per request)
   - TTL enabled on connections table for automatic cleanup

3. **Environment Variables**:
   - `APP=stenoai` (used for table naming)
   - `ENV=dev` (used for table naming)
   - `REGION=us-east-1` (DynamoDB region)

### 15.2 Invitation System Setup Requirements

**Before starting PR #27**, ensure:

1. **Database Migration**:

   - Create migration file `0007_invitations.sql` with table schema
   - Run migration via `scripts/migrate.sh` or `scripts/migrate_via_lambda.sh`
   - Verify table and indexes created successfully

2. **Token Security**:

   - Use cryptographically secure random token generation (`crypto.randomBytes`)
   - Token length: minimum 32 bytes (256 bits)
   - Store tokens as unique in database
   - Validate token expiration on every access

3. **In-App Notification System**:
   - Implement notification UI for invitation acceptance
   - Badge count for pending invitations on Dashboard
   - Real-time updates when collaborators join

### 15.3 Implementation Order (Critical)

**Core Collaboration Features First**:

- PR #21: WebSocket Infrastructure (Foundation)
- PR #22: Y.js Integration (Core collaboration)
- PR #25: User Presence System
- PR #26: Collaboration UI/UX
- PR #27: Invitation Database & API
- PR #28: Invitation UI Components

**Optional Features** (After Performance PRD - separate from core collaboration):

- PR #23: Progressive AI Generation (requires parallel chunk processing from Performance PRD)
- PR #24: Refinement Progress (requires parallel chunk processing from Performance PRD)

### 15.4 Testing Checklist

Before marking any PR complete:

- [ ] Multiple Lambda instances can see each other's connections (test with 2+ concurrent connections)
- [ ] Reconnection works with `lastKnownVersion` parameter
- [ ] Y.js updates don't cause infinite loops (check CloudWatch logs)
- [ ] AI generation properly integrates with Y.js (generated text syncs to all users)
- [ ] Snapshot creation doesn't conflict with multiple clients
- [ ] DynamoDB TTL cleans up stale connections (wait 1 hour or manually test)
- [ ] Permission revocation disconnects affected users
- [ ] Invitation tokens are cryptographically secure and unique
- [ ] Invitation expiration works correctly (test with expired tokens)
- [ ] Invitation acceptance creates `document_collaborators` record
- [ ] Invitation acceptance works for both logged-in and logged-out users
- [ ] Invitation resend creates new token and invalidates old token
- [ ] Invitation cancellation prevents acceptance
- [ ] Cancelled invitation shows appropriate error message
- [ ] Collaborator removal disconnects active WebSocket connections
- [ ] Role change (editor ↔ viewer) works correctly
- [ ] Viewer role cannot send update messages (READ_ONLY_ACCESS error)
- [ ] Viewers can receive real-time updates but cannot edit
- [ ] Document deletion disconnects all collaborators and expires invitations
- [ ] Duplicate pending invitations are prevented (unique constraint)
- [ ] Invitation status transitions work correctly (pending → accepted/declined/expired/cancelled)
- [ ] Concurrent invitation acceptance prevented (race condition handling)
- [ ] Invalid token error messages display correctly (expired, cancelled, already accepted)
- [ ] Inviting existing collaborator returns appropriate error
- [ ] Invitation rate limiting works (50 per document/hour, 10 per user/hour)
- [ ] JWT expiration during active collaboration handled gracefully
- [ ] Multiple device connections work correctly (same user, different devices)
- [ ] Connection limits enforced (10 per user, 100 per document)
- [ ] User account deletion cascades correctly (invitations, collaborations)
- [ ] Snapshot cleanup runs correctly (keep last 10, delete > 30 days)
- [ ] Message ordering handled correctly (CRDT merge works with out-of-order messages)
- [ ] AI refinement lock works correctly (same as generation lock)
- [ ] Refinement events broadcast to all connected clients
- [ ] Concurrent AI operation prevention (generation + refinement cannot run simultaneously)
- [ ] AI operation permissions enforced (viewers cannot trigger)
- [ ] Export uses Y.js state (not RDS draft_text) during collaboration
- [ ] Export doesn't block editing (multiple exports can run simultaneously)
- [ ] Y.js state syncs to RDS on snapshot creation
- [ ] Data migration works (old documents initialize Y.js from RDS)
- [ ] Logout closes WebSocket connections gracefully
- [ ] Role change during active session enforces new permissions immediately
- [ ] History restore lock works correctly (same as generation/refinement lock)
- [ ] Restore events broadcast to all connected clients
- [ ] Restore permissions enforced (only owner can restore)
- [ ] Restore warning shown when active collaborators exist
- [ ] Y.js state reset on restore (complete document replacement)
- [ ] Restore overwrites collaborative edits correctly
- [ ] Document metadata changes broadcast to all clients
- [ ] Template selection doesn't affect active collaboration

---

---

## 17. Interview Demo Requirements

### 17.1 Core Demo Features

**Must Demonstrate** (5-7 minute live demo):

1. **Document Upload & AI Generation**

   - Upload a sample medical record or police report
   - Select a demand letter template
   - Show AI generation process
   - Demonstrate how generated content integrates with collaboration

2. **Real-Time Collaboration**

   - Open same document in 2 browser tabs (side-by-side)
   - Type in one tab, show instant sync in other tab
   - Demonstrate cursor positions or presence indicators
   - Show graceful handling when one tab disconnects

3. **Template Management**

   - Create/edit custom template
   - Show template variables and how they populate
   - Demonstrate firm-specific customization

4. **AI Refinement**

   - Add instructions to refine generated draft
   - Show before/after comparison
   - Highlight AI's ability to adjust tone/content

5. **Export Functionality**
   - Export final draft to Word document
   - Show proper formatting preservation
   - Demonstrate ready-to-use output

### 17.2 Technical Highlights for Interview

**Architecture Discussion Points**:

- **Serverless Architecture**: AWS Lambda + API Gateway (cost-efficient, auto-scaling)
- **Real-Time**: WebSocket API with DynamoDB for stateless collaboration
- **CRDT**: Y.js for conflict-free collaborative editing (advanced distributed systems)
- **AI Integration**: AWS Bedrock for Claude AI (production-ready, scalable)
- **Data Persistence**: PostgreSQL for structured data, DynamoDB for real-time state
- **Security**: JWT authentication, encrypted WebSocket (WSS), input validation

**Code Quality Highlights**:

- TypeScript for type safety
- Error handling middleware
- Idempotency for critical operations
- Comprehensive testing (unit, integration, E2E)
- CI/CD ready architecture

### 17.3 Expected Interview Questions & Answers

**Q: How does conflict resolution work with multiple users editing?**
A: "We use Y.js, a CRDT (Conflict-free Replicated Data Type) library. It handles concurrent edits automatically without requiring a central authority. Each edit is represented as an operation that can be applied in any order, and Y.js merges them deterministically. This means User A typing 'Hello' and User B typing 'World' at the same position will merge predictably without data loss."

**Q: What happens if the WebSocket connection drops?**
A: "We implement automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s, max 5 attempts). During disconnection, the client maintains local Y.js state. On reconnect, we sync only the operations missed during downtime using a version vector. The user sees 'Reconnecting...' status but their work is never lost thanks to the CRDT properties."

**Q: How do you scale this for many concurrent users?**
A: "The architecture is stateless. We use DynamoDB to track active connections across multiple Lambda instances. When a user sends an update, we query DynamoDB's documentId index to find all connections for that document, then broadcast to each. Lambda auto-scales, DynamoDB handles high throughput, and Y.js keeps operations small (typically < 1KB)."

**Q: Security concerns with WebSockets?**
A: "Multiple layers: 1) JWT authentication on connection with expiration checks, 2) Encrypted WebSocket (WSS) for transport security, 3) Input validation on every message with rate limiting (100 msgs/sec), 4) Document access validation before joining a room, 5) Origin header validation to prevent CSRF."

**Q: How do you handle AI generation during active collaboration?**
A: "We implement a generation lock. When AI generation starts, the document enters 'generating' state and editing is disabled with a clear UI indicator ('AI is generating...'). Once complete, the generated text is applied as a single Y.js update, which propagates to all connected users. This prevents users from editing content that's about to be replaced."

**Q: What's your error handling strategy?**
A: "We use custom error classes (ValidationError, NotFoundError, etc.) with a global error handler middleware. Errors are logged with context (userId, requestId) for debugging. User-facing errors are clear and actionable ('Connection lost. Reconnecting...' vs 'WebSocket error 1006'). Critical operations use retry logic with exponential backoff."

**Q: How do you test real-time collaboration?**
A: "Three levels: 1) Unit tests for Y.js integration and message handling, 2) Integration tests simulating multiple clients with mock WebSocket connections, 3) E2E tests using Playwright with two browser contexts editing the same document simultaneously. We also have load tests for 100+ concurrent connections per document."

**Q: What would you improve given more time?**
A: "Three things: 1) Add cursor position sharing so users see where others are typing, 2) Implement operational metrics dashboard (active users, message latency, error rates), 3) Add document version history with rollback capability. These are nice-to-haves that enhance the experience but aren't critical for core functionality."

**Q: How do you handle database migrations?**
A: "SQL migrations in `/migrations` folder with version numbers (0001_init.sql, 0002_refinements.sql). We have scripts to run migrations via Lambda (migrate_via_lambda.sh) or directly (migrate.sh). Each migration is idempotent using CREATE IF NOT EXISTS and conditional logic. We maintain a migrations log table to track applied versions."

**Q: What's your deployment strategy?**
A: "Infrastructure as Code using AWS CLI scripts. We have separate scripts for each component (VPC, RDS, Lambda, API Gateway, DynamoDB). Environment-specific configs (dev/prod) via environment variables. Build process creates Lambda deployment packages with all dependencies. Zero-downtime deployments using Lambda versioning."

### 17.4 Demo Preparation Checklist

**Before Interview**:

- [ ] Seed database with 2-3 sample templates
- [ ] Prepare 2-3 sample documents to upload (medical record, police report)
- [ ] Test complete workflow end-to-end
- [ ] Open demo in 2 browser tabs (side-by-side for collaboration demo)
- [ ] Clear browser cache and test fresh load
- [ ] Have architecture diagram ready to share
- [ ] Prepare code samples to discuss (Y.js integration, WebSocket handler)
- [ ] Test on stable internet connection

**Demo Script** (7 minutes):

1. **Intro** (30s): "I built a demand letter generator with real-time collaboration for law firms"
2. **Upload** (30s): Upload document, show extraction
3. **Generate** (60s): Select template, generate with progress indicator
4. **Collaborate** (90s): Open 2nd tab, type in both, show sync **← Wow moment**
5. **Refine** (60s): Add instructions, show AI refinement
6. **Template** (60s): Show template editor, explain customization
7. **Export** (30s): Export to Word, show result
8. **Architecture** (90s): Explain tech stack, WebSocket + CRDT, scaling strategy
9. **Q&A** (remaining time): Answer technical questions

---

**Last Updated**: January 2025  
**Status**: Ready for Implementation  
**Dependencies**:

- DynamoDB tables created ✅
- IAM permissions updated ✅
- Performance PRD features (progressive generation) will be implemented separately
