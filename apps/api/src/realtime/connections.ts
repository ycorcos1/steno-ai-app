import {
  AttributeValue,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.REGION || "us-east-1";
const APP_NAME = process.env.APP || "stenoai";
const ENV = process.env.ENV || "dev";
const CONNECTIONS_TABLE = `${APP_NAME}-${ENV}-connections`;
const THIRTY_MINUTES_SECONDS = 30 * 60;

const dynamo = new DynamoDBClient({ region: REGION });

export interface ConnectionRecord {
  connectionId: string;
  userId: string;
  documentId?: string | null;
  connectedAt: number;
  lastActivityAt: number;
  endpoint: string;
  ttl?: number;
}

function computeTtlSeconds(): number {
  return Math.floor(Date.now() / 1000) + THIRTY_MINUTES_SECONDS;
}

function toAttributeMap(record: ConnectionRecord): Record<string, AttributeValue> {
  const item: Record<string, AttributeValue> = {
    connectionId: { S: record.connectionId },
    userId: { S: record.userId },
    connectedAt: { N: record.connectedAt.toString() },
    lastActivityAt: { N: record.lastActivityAt.toString() },
    endpoint: { S: record.endpoint },
    ttl: { N: (record.ttl ?? computeTtlSeconds()).toString() },
  };

  if (record.documentId) {
    item.documentId = { S: record.documentId };
  }

  return item;
}

function fromAttributeMap(
  item?: Record<string, AttributeValue>
): ConnectionRecord | null {
  if (!item) {
    return null;
  }

  return {
    connectionId: item.connectionId?.S ?? "",
    userId: item.userId?.S ?? "",
    documentId: item.documentId?.S ?? null,
    connectedAt: item.connectedAt?.N ? Number(item.connectedAt.N) : Date.now(),
    lastActivityAt: item.lastActivityAt?.N
      ? Number(item.lastActivityAt.N)
      : Date.now(),
    endpoint: item.endpoint?.S ?? "",
    ttl: item.ttl?.N ? Number(item.ttl.N) : undefined,
  };
}

export async function saveConnection(record: ConnectionRecord): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: toAttributeMap(record),
    })
  );
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await dynamo.send(
    new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId: { S: connectionId },
      },
    })
  );
}

export async function getConnection(
  connectionId: string
): Promise<ConnectionRecord | null> {
  const response = await dynamo.send(
    new GetItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId: { S: connectionId } },
      ConsistentRead: true,
    })
  );

  return fromAttributeMap(response.Item);
}

export async function getConnectionsByDocument(
  documentId: string
): Promise<ConnectionRecord[]> {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "documentId-index",
      KeyConditionExpression: "#documentId = :documentId",
      ExpressionAttributeNames: {
        "#documentId": "documentId",
      },
      ExpressionAttributeValues: {
        ":documentId": { S: documentId },
      },
    })
  );

  return (response.Items || [])
    .map((item) => fromAttributeMap(item))
    .filter((item): item is ConnectionRecord => Boolean(item));
}

export async function getConnectionsByUser(
  userId: string
): Promise<ConnectionRecord[]> {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "userId-index",
      KeyConditionExpression: "#userId = :userId",
      ExpressionAttributeNames: {
        "#userId": "userId",
      },
      ExpressionAttributeValues: {
        ":userId": { S: userId },
      },
    })
  );

  return (response.Items || [])
    .map((item) => fromAttributeMap(item))
    .filter((item): item is ConnectionRecord => Boolean(item));
}

/**
 * Clean up stale connections for a user (older than 5 minutes with no activity)
 * Returns the number of connections cleaned up
 */
export async function cleanupStaleUserConnections(
  userId: string
): Promise<number> {
  const connections = await getConnectionsByUser(userId);
  const now = Date.now();
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  let cleanedCount = 0;
  for (const conn of connections) {
    // Consider connection stale if last activity was more than 5 minutes ago
    if (now - conn.lastActivityAt > STALE_THRESHOLD_MS) {
      try {
        await deleteConnection(conn.connectionId);
        cleanedCount++;
      } catch (error) {
        console.error(
          `Failed to clean up stale connection ${conn.connectionId}:`,
          error
        );
      }
    }
  }

  return cleanedCount;
}

export async function getUserConnectionCount(userId: string): Promise<number> {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "userId-index",
      KeyConditionExpression: "#userId = :userId",
      ExpressionAttributeNames: {
        "#userId": "userId",
      },
      ExpressionAttributeValues: {
        ":userId": { S: userId },
      },
      Select: "COUNT",
    })
  );

  return response.Count ?? 0;
}

export async function getDocumentConnectionCount(
  documentId: string
): Promise<number> {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "documentId-index",
      KeyConditionExpression: "#documentId = :documentId",
      ExpressionAttributeNames: {
        "#documentId": "documentId",
      },
      ExpressionAttributeValues: {
        ":documentId": { S: documentId },
      },
      Select: "COUNT",
    })
  );

  return response.Count ?? 0;
}

export async function setConnectionDocument(
  connectionId: string,
  documentId: string
): Promise<void> {
  const now = Date.now();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId: { S: connectionId } },
      UpdateExpression:
        "SET documentId = :documentId, lastActivityAt = :lastActivityAt, #ttl = :ttl",
      ExpressionAttributeNames: {
        "#ttl": "ttl",
      },
      ExpressionAttributeValues: {
        ":documentId": { S: documentId },
        ":lastActivityAt": { N: now.toString() },
        ":ttl": { N: computeTtlSeconds().toString() },
      },
    })
  );
}

export async function updateConnectionActivity(
  connectionId: string
): Promise<void> {
  const now = Date.now();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId: { S: connectionId } },
      UpdateExpression: "SET lastActivityAt = :lastActivityAt, #ttl = :ttl",
      ExpressionAttributeNames: {
        "#ttl": "ttl",
      },
      ExpressionAttributeValues: {
        ":lastActivityAt": { N: now.toString() },
        ":ttl": { N: computeTtlSeconds().toString() },
      },
    })
  );
}

export async function listAllConnections(): Promise<ConnectionRecord[]> {
  const records: ConnectionRecord[] = [];
  let ExclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const response = await dynamo.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        ExclusiveStartKey,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const record = fromAttributeMap(item);
        if (record) {
          records.push(record);
        }
      }
    }

    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return records;
}

export async function checkActiveCollaborators(
  documentId: string
): Promise<boolean> {
  const count = await getDocumentConnectionCount(documentId);
  return count > 0;
}

/**
 * Disconnect all WebSocket connections for a user, optionally filtered by document
 * This function is used when a user's access is revoked or their role changes
 * @param userId User ID whose connections should be disconnected
 * @param documentId Optional document ID to filter connections (if provided, only disconnects connections to this document)
 * @returns Array of connection IDs that were disconnected
 */
export async function disconnectUserConnections(
  userId: string,
  documentId?: string
): Promise<string[]> {
  const {
    ApiGatewayManagementApiClient,
    DeleteConnectionCommand,
  } = await import("@aws-sdk/client-apigatewaymanagementapi");

  let connections: ConnectionRecord[];
  if (documentId) {
    // Get connections for this user on this specific document
    const allDocConnections = await getConnectionsByDocument(documentId);
    connections = allDocConnections.filter((conn) => conn.userId === userId);
  } else {
    // Get all connections for this user
    connections = await getConnectionsByUser(userId);
  }

  const disconnectedIds: string[] = [];

  for (const conn of connections) {
    try {
      // Create API Gateway client for this connection's endpoint
      const client = new ApiGatewayManagementApiClient({
        region: process.env.REGION || "us-east-1",
        endpoint: conn.endpoint,
      });

      // Close the WebSocket connection
      await client.send(
        new DeleteConnectionCommand({
          ConnectionId: conn.connectionId,
        })
      );

      // Delete from DynamoDB
      await deleteConnection(conn.connectionId);
      disconnectedIds.push(conn.connectionId);
    } catch (error: any) {
      // If connection is already gone, that's fine - just delete from DB
      if (error.name === "GoneException" || error.$metadata?.httpStatusCode === 410) {
        await deleteConnection(conn.connectionId);
        disconnectedIds.push(conn.connectionId);
      } else {
        console.error(
          `Failed to disconnect connection ${conn.connectionId}:`,
          error
        );
      }
    }
  }

  return disconnectedIds;
}


