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

  prompt += `\nGenerate a complete, polished demand letter following the template structure and incorporating all relevant information from the extracted text. Be professional, precise, and legally appropriate.

IMPORTANT: Return ONLY the demand letter text. Do not include any introductory text, explanations, meta-commentary, or phrases like "Here's a professional demand letter" or "Here is the demand letter". Start directly with the letter content (e.g., sender address, date, recipient address, salutation).`;

  return prompt;
}
