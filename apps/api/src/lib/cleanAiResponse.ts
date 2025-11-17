/**
 * Clean AI response by removing common prefix text
 * that the AI might add despite instructions
 */
export function cleanAiResponse(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Common prefixes to remove (case-insensitive)
  const prefixes = [
    /^Here's the refined version incorporating the requested change:\s*/i,
    /^Here's the refined version:\s*/i,
    /^Here is the refined version:\s*/i,
    /^Here's the refined draft:\s*/i,
    /^Here is the refined draft:\s*/i,
    /^Refined version:\s*/i,
    /^Refined draft:\s*/i,
    /^Here's the updated version:\s*/i,
    /^Here is the updated version:\s*/i,
    /^Here's a professional demand letter based on the provided template and case information:\s*/i,
    /^Here's a professional demand letter:\s*/i,
    /^Here is a professional demand letter:\s*/i,
    /^Here's the demand letter:\s*/i,
    /^Here is the demand letter:\s*/i,
    /^Here's the generated draft:\s*/i,
    /^Here is the generated draft:\s*/i,
    /^Here's the draft:\s*/i,
    /^Here is the draft:\s*/i,
    /^Based on the provided template and case information, here's a professional demand letter:\s*/i,
    /^Based on the template and case information:\s*/i,
  ];

  let cleaned = text.trim();

  // Try each prefix pattern
  for (const prefix of prefixes) {
    if (prefix.test(cleaned)) {
      cleaned = cleaned.replace(prefix, '').trim();
      break; // Only remove one prefix
    }
  }

  return cleaned;
}

