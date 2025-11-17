// API Gateway WebSocket has a 32KB message size limit
// We use 28KB to leave room for JSON overhead and metadata
const MAX_MESSAGE_BYTES = 28 * 1024; // 28KB
const MAX_ACTION_LENGTH = 50;
const MAX_DOCUMENT_ID_LENGTH = 36;
const ALLOWED_ACTIONS = new Set([
  "join",
  "update",
  "presence",
  "create_snapshot",
  "leave",
  "ping",
  "pong",
]);

export interface ValidationResult {
  valid: boolean;
  code?: string;
  message?: string;
}

export function validateRawMessageSize(body: string | null): ValidationResult {
  if (!body) {
    return { valid: false, code: "INVALID_PAYLOAD", message: "Empty message" };
  }

  const size = Buffer.byteLength(body, "utf8");
  if (size > MAX_MESSAGE_BYTES) {
    return {
      valid: false,
      code: "MESSAGE_TOO_LARGE",
      message: `Message exceeds ${MAX_MESSAGE_BYTES} bytes`,
    };
  }

  return { valid: true };
}

export function validateMessage(message: any): ValidationResult {
  if (!message || typeof message !== "object") {
    return {
      valid: false,
      code: "INVALID_PAYLOAD",
      message: "Message must be a JSON object",
    };
  }

  if (!message.action || typeof message.action !== "string") {
    return {
      valid: false,
      code: "INVALID_ACTION",
      message: "Missing action field",
    };
  }

  if (
    message.action.length > MAX_ACTION_LENGTH ||
    !ALLOWED_ACTIONS.has(message.action)
  ) {
    return {
      valid: false,
      code: "INVALID_ACTION",
      message: "Action not allowed",
    };
  }

  // Actions that require documentId
  const actionsRequiringDocumentId = new Set(["join", "update", "create_snapshot"]);
  
  if (actionsRequiringDocumentId.has(message.action)) {
    // documentId is required for these actions
    if (!message.documentId || typeof message.documentId !== "string" || message.documentId.trim() === "") {
      return {
        valid: false,
        code: "INVALID_DOCUMENT_ID",
        message: "Document ID is required for this action",
      };
    }
    
    if (
      message.documentId.length > MAX_DOCUMENT_ID_LENGTH ||
      !isValidUUID(message.documentId)
    ) {
      return {
        valid: false,
        code: "INVALID_DOCUMENT_ID",
        message: "Document ID must be a valid UUID",
      };
    }
  } else if (message.documentId) {
    // For other actions, documentId is optional but if provided must be valid
    if (
      typeof message.documentId !== "string" ||
      message.documentId.trim() === "" ||
      message.documentId.length > MAX_DOCUMENT_ID_LENGTH ||
      !isValidUUID(message.documentId)
    ) {
      return {
        valid: false,
        code: "INVALID_DOCUMENT_ID",
        message: "Document ID must be a valid UUID",
      };
    }
  }

  if (message.update && typeof message.update === "string") {
    if (!isValidBase64(message.update)) {
      return {
        valid: false,
        code: "INVALID_ENCODING",
        message: "Update payload must be valid Base64",
      };
    }
  }

  return { valid: true };
}

export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function isValidBase64(value: string): boolean {
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}


