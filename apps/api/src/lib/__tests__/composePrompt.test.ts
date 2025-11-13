/**
 * Unit tests for composePrompt.ts
 */

import { composePrompt } from "../composePrompt";

describe("composePrompt", () => {
  it("should compose a basic prompt with extracted text and template", () => {
    const extractedText = "Client name: John Doe. Amount owed: $5000.";
    const templateContent = "Dear [Client], You owe [Amount].";

    const prompt = composePrompt(extractedText, templateContent);

    expect(prompt).toContain("legal drafting assistant");
    expect(prompt).toContain(extractedText);
    expect(prompt).toContain(templateContent);
    expect(prompt).toContain("Template:");
    expect(prompt).toContain("Extracted Information:");
  });

  it("should include additional instructions when provided", () => {
    const extractedText = "Client name: Jane Smith.";
    const templateContent = "Standard template.";
    const instructions = "Make it more formal and add urgency.";

    const prompt = composePrompt(extractedText, templateContent, instructions);

    expect(prompt).toContain("Additional Instructions:");
    expect(prompt).toContain(instructions);
  });

  it("should not include instructions section when instructions are not provided", () => {
    const extractedText = "Client name: Bob.";
    const templateContent = "Template.";

    const prompt = composePrompt(extractedText, templateContent);

    expect(prompt).not.toContain("Additional Instructions:");
  });

  it("should handle empty extracted text gracefully", () => {
    const templateContent = "Template content.";

    const prompt = composePrompt("", templateContent);

    expect(prompt).toContain("No extracted text available");
    expect(prompt).toContain(templateContent);
  });

  it("should handle empty template gracefully", () => {
    const extractedText = "Some extracted text.";

    const prompt = composePrompt(extractedText, "");

    expect(prompt).toContain(extractedText);
    expect(prompt).toContain("No template provided");
  });

  it("should handle null/undefined inputs gracefully", () => {
    const prompt1 = composePrompt(null as any, "template");
    const prompt2 = composePrompt("text", null as any);
    const prompt3 = composePrompt(null as any, null as any);

    expect(prompt1).toBeTruthy();
    expect(prompt2).toBeTruthy();
    expect(prompt3).toBeTruthy();
  });

  it("should trim whitespace from inputs", () => {
    const extractedText = "  Client: John  ";
    const templateContent = "  Template  ";

    const prompt = composePrompt(extractedText, templateContent);

    // Should not have leading/trailing whitespace in the structure
    expect(prompt).toContain("Client: John");
    expect(prompt).toContain("Template");
  });

  it("should produce a complete, coherent prompt", () => {
    const extractedText =
      "The client was injured in an accident on 2024-01-15.";
    const templateContent = "Demand letter template for personal injury cases.";
    const instructions = "Emphasize the severity of injuries.";

    const prompt = composePrompt(extractedText, templateContent, instructions);

    // Should have all sections
    expect(prompt).toMatch(/You are a legal drafting assistant/);
    expect(prompt).toMatch(/\*\*Template:\*\*/);
    expect(prompt).toMatch(/\*\*Extracted Information:\*\*/);
    expect(prompt).toMatch(/\*\*Additional Instructions:\*\*/);
    expect(prompt).toMatch(/Generate a complete, polished demand letter/);
  });

  it("should handle long text inputs", () => {
    const longText = "A".repeat(10000);
    const templateContent = "Template.";

    const prompt = composePrompt(longText, templateContent);

    expect(prompt.length).toBeGreaterThan(10000);
    expect(prompt).toContain(longText);
  });
});
