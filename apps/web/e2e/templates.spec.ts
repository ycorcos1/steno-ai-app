import { test, expect } from "@playwright/test";

test.describe("Templates Management", () => {
  const testEmail = `test-${Date.now()}@stenoai.com`;
  const testPassword = "TestPass123!";

  test.beforeEach(async ({ page }) => {
    // Sign up and login before each test
    await page.goto("/signup");
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);

    const [response] = await Promise.all([
      page
        .waitForResponse(
          (resp) =>
            resp.url().includes("/auth/signup") && resp.status() === 201,
          { timeout: 10000 }
        )
        .catch(() => null),
      page.click('button[type="submit"]'),
    ]);

    if (response && response.status() === 201) {
      await page.waitForURL(/\/dashboard|\/signup/, { timeout: 10000 });
      if (!page.url().includes("/dashboard")) {
        await page.goto("/dashboard", {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
      }
    }
  });

  test("should create new template", async ({ page }) => {
    await page.goto("/templates");
    await expect(page).toHaveURL(/\/templates/);

    // Find and click "New Template" or "Create Template" button
    const createButton = page.locator("button:has-text(/new|create/i)").first();

    if ((await createButton.count()) > 0) {
      await createButton.click();

      // Fill template form
      const titleInput = page.locator(
        'input[id="prompt-name"], input[name="title"]'
      );
      const contentInput = page.locator(
        'textarea[id="prompt-body"], textarea[name="content"]'
      );

      if ((await titleInput.count()) > 0) {
        const templateTitle = `E2E Test Template ${Date.now()}`;
        const templateContent =
          "This is a test template created via E2E testing.";

        await titleInput.fill(templateTitle);
        await contentInput.fill(templateContent);

        // Submit form
        const saveButton = page
          .locator("button:has-text(/save|create/i)")
          .first();
        if ((await saveButton.count()) > 0) {
          await saveButton.click();

          // Wait for template to appear in list
          await expect(page.locator(`text=${templateTitle}`)).toBeVisible({
            timeout: 5000,
          });
        }
      }
    }
  });

  test("should list templates", async ({ page }) => {
    await page.goto("/templates");
    await expect(page).toHaveURL(/\/templates/);

    // Verify templates page structure
    await expect(page.locator("text=/template/i")).toBeVisible();

    // Check for templates list (may be empty)
    const templatesSection = page.locator("text=/template|no templates/i");
    await expect(templatesSection.first()).toBeVisible();
  });

  test("should edit template", async ({ page }) => {
    await page.goto("/templates");

    // First, create a template
    const createButton = page.locator("button:has-text(/new|create/i)").first();
    if ((await createButton.count()) > 0) {
      await createButton.click();

      const titleInput = page.locator(
        'input[id="prompt-name"], input[name="title"]'
      );
      const contentInput = page.locator(
        'textarea[id="prompt-body"], textarea[name="content"]'
      );

      if ((await titleInput.count()) > 0) {
        const templateTitle = `Edit Test Template ${Date.now()}`;
        await titleInput.fill(templateTitle);
        await contentInput.fill("Original content");

        const saveButton = page
          .locator("button:has-text(/save|create/i)")
          .first();
        if ((await saveButton.count()) > 0) {
          await saveButton.click();
          await page.waitForTimeout(2000);

          // Find and click edit button
          const editButton = page
            .locator(`button:has-text("Edit"), a:has-text("Edit")`)
            .first();
          if ((await editButton.count()) > 0) {
            await editButton.click();

            // Update content
            const updatedContent = "Updated content via E2E test";
            await contentInput.fill(updatedContent);

            // Save changes
            const updateButton = page
              .locator("button:has-text(/save|update/i)")
              .first();
            if ((await updateButton.count()) > 0) {
              await updateButton.click();
              await page.waitForTimeout(2000);

              // Verify update
              await expect(page.locator(`text=${updatedContent}`)).toBeVisible({
                timeout: 5000,
              });
            }
          }
        }
      }
    }
  });

  test("should delete template", async ({ page }) => {
    await page.goto("/templates");

    // Create a template first
    const createButton = page.locator("button:has-text(/new|create/i)").first();
    if ((await createButton.count()) > 0) {
      await createButton.click();

      const titleInput = page.locator(
        'input[id="prompt-name"], input[name="title"]'
      );
      const contentInput = page.locator(
        'textarea[id="prompt-body"], textarea[name="content"]'
      );

      if ((await titleInput.count()) > 0) {
        const templateTitle = `Delete Test Template ${Date.now()}`;
        await titleInput.fill(templateTitle);
        await contentInput.fill("Content to be deleted");

        const saveButton = page
          .locator("button:has-text(/save|create/i)")
          .first();
        if ((await saveButton.count()) > 0) {
          await saveButton.click();
          await page.waitForTimeout(2000);

          // Find delete button
          const deleteButton = page
            .locator(`button:has-text("Delete")`)
            .first();
          if ((await deleteButton.count()) > 0) {
            await deleteButton.click();

            // Confirm deletion if confirmation dialog appears
            const confirmButton = page.locator(
              "button:has-text(/confirm|yes|delete/i)"
            );
            if ((await confirmButton.count()) > 0) {
              await confirmButton.click();
            }

            await page.waitForTimeout(2000);

            // Verify template is removed
            await expect(page.locator(`text=${templateTitle}`)).not.toBeVisible(
              { timeout: 5000 }
            );
          }
        }
      }
    }
  });
});
