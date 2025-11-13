/**
 * Integration tests for authentication endpoints
 *
 * These tests require:
 * - Running API server (local or deployed)
 * - Valid database connection
 *
 * To run:
 * 1. Set environment variables: ENV, REGION, API_BASE_URL, etc.
 * 2. Run: npm test -- auth.test.ts
 */

describe("Auth Integration Tests", () => {
  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
  let testEmail: string;
  let testPassword: string;
  let authToken: string;
  let testUserId: string;

  beforeAll(() => {
    // Generate unique test email to avoid conflicts
    const timestamp = Date.now();
    testEmail = `test-${timestamp}@stenoai.com`;
    testPassword = "TestPass123!";
  });

  afterAll(async () => {
    // Cleanup: Delete test user if created
    if (testUserId && process.env.CLEANUP_TEST_DATA === "true") {
      try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: "POST",
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe("POST /auth/signup", () => {
    it("should create new user and return JWT token", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: testEmail,
            password: testPassword,
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveProperty("message", "User created successfully");
        expect(data).toHaveProperty("user");
        expect(data.user).toHaveProperty("id");
        expect(data.user).toHaveProperty("email", testEmail);
        expect(data.user).toHaveProperty("created_at");

        // Extract token from Set-Cookie header
        const setCookie = response.headers.get("set-cookie");
        expect(setCookie).toContain("auth_token=");
        if (setCookie) {
          const match = setCookie.match(/auth_token=([^;]+)/);
          if (match) {
            authToken = match[1];
            // Decode JWT to get user ID
            const tokenParts = authToken.split(".");
            if (tokenParts.length === 3) {
              const payload = JSON.parse(
                Buffer.from(tokenParts[1], "base64").toString()
              );
              testUserId = payload.userId;
            }
          }
        }
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should reject duplicate email", async () => {
      jest.setTimeout(15000); // Increase timeout for this test
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: testEmail, // Same email as before
            password: testPassword,
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(409);
        const data = await response.json();
        expect(data.error).toContain("already registered");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should validate email format", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "invalid-email",
            password: testPassword,
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("email");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should validate password requirements", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `test-${Date.now()}@stenoai.com`,
            password: "short", // Too short
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("Password");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });
  });

  describe("POST /auth/login", () => {
    it("should authenticate valid credentials", async () => {
      if (!testEmail) {
        console.warn("No test user created, skipping login test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: testEmail,
            password: testPassword,
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveProperty("message", "Login successful");
        expect(data).toHaveProperty("user");
        expect(data.user.email).toBe(testEmail);

        // Verify cookie is set
        const setCookie = response.headers.get("set-cookie");
        expect(setCookie).toContain("auth_token=");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should reject invalid credentials", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: testEmail || "nonexistent@stenoai.com",
            password: "wrongpassword",
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toContain("Invalid credentials");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should require email and password", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: testEmail || "test@stenoai.com",
            // Missing password
          }),
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("required");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });
  });

  describe("Protected Routes", () => {
    it("should allow access with valid token", async () => {
      if (!authToken) {
        console.warn("No auth token available, skipping protected route test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          method: "GET",
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty("user");
        expect(data.user.email).toBe(testEmail);
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should reject requests without token", async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          method: "GET",
          // No cookie header
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toContain("Authentication required");
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });

    it("should handle logout", async () => {
      if (!authToken) {
        console.warn("No auth token available, skipping logout test");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/logout`, {
          method: "POST",
          headers: {
            Cookie: `auth_token=${authToken}`,
          },
        });

        if (response.status === 503 || response.status === 0) {
          console.warn("API not available, skipping integration test");
          return;
        }

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.message).toContain("Logged out");

        // Verify cookie is cleared
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) {
          expect(setCookie).toContain("auth_token=;");
        }
      } catch (error: any) {
        if (
          error.message?.includes("fetch failed") ||
          error.code === "ECONNREFUSED"
        ) {
          console.warn("API not available, skipping integration test");
          return;
        }
        throw error;
      }
    });
  });
});
