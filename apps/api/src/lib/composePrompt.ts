/**
 * Prompt composition utilities for AI draft generation
 * Combines extracted text, template content, and optional instructions
 */

/**
 * Compose a structured prompt for Bedrock Claude model
 * @param extractedText - Text extracted from uploaded document
 * @param templateContent - Template content to follow
 * @param instructions - Optional additional user instructions
 * @returns Formatted prompt string
 */
export function composePrompt(
  extractedText: string,
  templateContent: string,
  instructions?: string
): string {
  // Handle empty/null inputs gracefully
  const safeExtracted = extractedText?.trim() || "No extracted text available.";
  const safeTemplate = templateContent?.trim() || "No template provided.";
  const safeInstructions = instructions?.trim();

  let prompt = `You are a legal drafting assistant. Generate a professional demand letter based on the following:

**Template:**
${safeTemplate}

**Extracted Information:**
${safeExtracted}
`;

  if (safeInstructions) {
    prompt += `\n**Additional Instructions:**\n${safeInstructions}\n\n`;
  }

  prompt += `\nGenerate a complete, polished demand letter following the template structure and incorporating all relevant information from the extracted text. Be professional, precise, and legally appropriate.`;

  return prompt;
}
