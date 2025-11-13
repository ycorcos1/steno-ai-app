import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  const testEmail = `test-${Date.now()}@stenoai.com`;
  const testPassword = "TestPass123!";

  test.beforeEach(async ({ page }) => {
    // Clear cookies and storage before each test
    await page.context().clearCookies();
  });

  test("should allow user to sign up", async ({ page }) => {
    await page.goto("/signup");

    // Fill in signup form
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);

    // Wait for network request to complete
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (resp) =>
            resp.url().includes("/auth/signup") && resp.status() === 201,
          { timeout: 5000 }
        )
        .catch(() => null),
      page.click('button[type="submit"]'),
    ]);

    // Check if signup was successful
    if (response && response.status() === 201) {
      // Wait for redirect or check if we're on dashboard
      await page.waitForURL(/\/dashboard|\/signup/, { timeout: 5000 });
      const currentUrl = page.url();
      if (currentUrl.includes("/dashboard")) {
        // Success - we're on dashboard
        expect(currentUrl).toContain("/dashboard");
      } else {
        // Check for error message
        const errorElement = page.locator("text=/error|invalid|failed/i");
        if ((await errorElement.count()) > 0) {
          const errorText = await errorElement.first().textContent();
          throw new Error(`Signup failed: ${errorText}`);
        }
        // If no error, might be a redirect issue - check if user is actually logged in
        await page.goto("/dashboard", {
          waitUntil: "domcontentloaded",
          timeout: 5000,
        });
        const finalUrl = page.url();
        if (!finalUrl.includes("/dashboard")) {
          throw new Error("Signup succeeded but redirect failed");
        }
      }
    } else {
      // Check for error message
      const errorElement = page.locator("text=/error|invalid|failed/i");
      if ((await errorElement.count()) > 0) {
        const errorText = await errorElement.first().textContent();
        throw new Error(`Signup failed: ${errorText}`);
      }
      throw new Error("Signup request did not complete successfully");
    }
  });

  test("should allow user to log in", async ({ page }) => {
    // First, create a user via signup
    await page.goto("/signup");
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);

    const [signupResponse] = await Promise.all([
      page
        .waitForResponse(
          (resp) =>
            resp.url().includes("/auth/signup") && resp.status() === 201,
          { timeout: 5000 }
        )
        .catch(() => null),
      page.click('button[type="submit"]'),
    ]);

    if (signupResponse && signupResponse.status() === 201) {
      await page.waitForURL(/\/dashboard|\/signup/, { timeout: 5000 });
      if (!page.url().includes("/dashboard")) {
        await page.goto("/dashboard", {
          waitUntil: "domcontentloaded",
          timeout: 5000,
        });
      }
    }

    // Now test login
    await page.goto("/login");
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);

    const [loginResponse] = await Promise.all([
      page
        .waitForResponse(
          (resp) => resp.url().includes("/auth/login") && resp.status() === 200,
          { timeout: 5000 }
        )
        .catch(() => null),
      page.click('button[type="submit"]'),
    ]);

    if (loginResponse && loginResponse.status() === 200) {
      await page.waitForURL(/\/dashboard|\/login/, { timeout: 10000 });
      const currentUrl = page.url();
      if (currentUrl.includes("/dashboard")) {
        expect(currentUrl).toContain("/dashboard");
      } else {
        // Check for errors or try navigating to dashboard
        const errorElement = page.locator("text=/error|invalid|failed/i");
        if ((await errorElement.count()) === 0) {
          await page.goto("/dashboard", {
            waitUntil: "domcontentloaded",
            timeout: 5000,
          });
          expect(page.url()).toContain("/dashboard");
        } else {
          const errorText = await errorElement.first().textContent();
          throw new Error(`Login failed: ${errorText}`);
        }
      }
    } else {
      throw new Error("Login request did not complete successfully");
    }
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "nonexistent@stenoai.com");
    await page.fill('input[name="password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(page.locator("text=/invalid|error|credentials/i")).toBeVisible(
      { timeout: 5000 }
    );
  });

  test("should redirect unauthenticated users to login", async ({ page }) => {
    // Try to access protected route
    await page.goto("/dashboard");

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("should validate required fields", async ({ page }) => {
    await page.goto("/signup");

    // Try to submit without filling fields
    await page.click('button[type="submit"]');

    // Should show validation error or prevent submission
    // Check if form is still on signup page or shows error
    const currentUrl = page.url();
    expect(currentUrl).toContain("/signup");
  });

  test("should validate email format", async ({ page }) => {
    await page.goto("/signup");
    await page.fill('input[name="email"]', "invalid-email");
    await page.fill('input[name="password"]', testPassword);
    await page.click('button[type="submit"]');

    // Should show validation error
    // Browser native validation or custom error should appear
    const emailInput = page.locator('input[name="email"]');
    const isInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    );
    expect(isInvalid).toBe(true);
  });
});
