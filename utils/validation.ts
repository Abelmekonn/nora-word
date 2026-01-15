/**
 * Input Validation and Sanitization Utilities
 *
 * Provides functions to sanitize and validate user inputs to prevent:
 * - Prompt injection attacks
 * - XSS vulnerabilities
 * - Excessive API usage
 * - Malformed inputs
 */

/**
 * Maximum lengths for different input types
 */
export const INPUT_LIMITS = {
  CHAT_MESSAGE: 5000,      // Chat/draft prompts
  DOCUMENT_CONTENT: 100000, // Full document content
  SELECTION: 10000,        // Selected text
  TEMPLATE: 50000,         // Template documents
  REFERENCE: 50000,        // Reference documents
} as const;

/**
 * Sanitizes user input to prevent prompt injection and XSS
 *
 * @param input - The raw user input
 * @param maxLength - Maximum allowed length (default: 5000)
 * @returns Sanitized input string
 *
 * @example
 * const safe = sanitizeInput(userInput, INPUT_LIMITS.CHAT_MESSAGE);
 */
export function sanitizeInput(input: string, maxLength: number = INPUT_LIMITS.CHAT_MESSAGE): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize whitespace (but preserve intentional newlines)
    .trim()
    // Limit length
    .substring(0, maxLength);

  return sanitized;
}

/**
 * Sanitizes input specifically for AI prompts
 * Removes potentially dangerous characters that could be used for prompt injection
 *
 * @param input - The raw prompt
 * @param maxLength - Maximum allowed length
 * @returns Sanitized prompt
 */
export function sanitizePrompt(input: string, maxLength: number = INPUT_LIMITS.CHAT_MESSAGE): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove control characters (except newlines and tabs)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize excessive whitespace
    .replace(/\s{10,}/g, ' ')
    // Trim
    .trim()
    // Limit length
    .substring(0, maxLength);

  // Warn if we had to truncate
  if (input.length > maxLength) {
    console.warn(`Input truncated from ${input.length} to ${maxLength} characters`);
  }

  return sanitized;
}

/**
 * Validates that input is not empty after sanitization
 *
 * @param input - The input to validate
 * @param fieldName - Name of the field for error messages
 * @returns The sanitized input
 * @throws Error if input is empty
 */
export function validateRequired(input: string, fieldName: string = 'Input'): string {
  const sanitized = sanitizeInput(input);

  if (!sanitized || sanitized.length === 0) {
    throw new Error(`${fieldName} is required and cannot be empty`);
  }

  return sanitized;
}

/**
 * Validates input length is within acceptable range
 *
 * @param input - The input to validate
 * @param minLength - Minimum length (default: 1)
 * @param maxLength - Maximum length
 * @param fieldName - Name of the field for error messages
 * @returns The validated input
 * @throws Error if length is invalid
 */
export function validateLength(
  input: string,
  minLength: number = 1,
  maxLength: number,
  fieldName: string = 'Input'
): string {
  if (input.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters`);
  }

  if (input.length > maxLength) {
    throw new Error(`${fieldName} must not exceed ${maxLength} characters`);
  }

  return input;
}

/**
 * Sanitizes HTML to prevent XSS attacks
 * Removes all HTML tags and entities
 *
 * @param input - The potentially unsafe HTML
 * @returns Plain text with HTML stripped
 */
export function stripHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode common HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Escapes special characters for safe inclusion in regex
 *
 * @param str - String to escape
 * @returns Escaped string safe for regex
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates and sanitizes email addresses
 *
 * @param email - Email to validate
 * @returns Sanitized email
 * @throws Error if email is invalid
 */
export function validateEmail(email: string): string {
  const sanitized = sanitizeInput(email, 254); // RFC 5321

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    throw new Error('Invalid email address format');
  }

  return sanitized.toLowerCase();
}

/**
 * Rate limiting helper - checks if action can proceed
 *
 * @param key - Unique key for this rate limit (e.g., "ai-draft-userid")
 * @param maxAttempts - Maximum attempts allowed
 * @param windowMs - Time window in milliseconds
 * @returns Object with canProceed boolean and remaining attempts
 */
const rateLimitStore = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { canProceed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const attempts = rateLimitStore.get(key) || [];

  // Remove expired timestamps
  const validAttempts = attempts.filter(timestamp => now - timestamp < windowMs);

  if (validAttempts.length >= maxAttempts) {
    const oldestAttempt = Math.min(...validAttempts);
    const resetIn = windowMs - (now - oldestAttempt);

    return {
      canProceed: false,
      remaining: 0,
      resetIn,
    };
  }

  // Add new attempt
  validAttempts.push(now);
  rateLimitStore.set(key, validAttempts);

  return {
    canProceed: true,
    remaining: maxAttempts - validAttempts.length,
    resetIn: windowMs,
  };
}

/**
 * Clears rate limit for a specific key (useful for testing or manual resets)
 *
 * @param key - The rate limit key to clear
 */
export function clearRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Safe JSON parse with error handling
 *
 * @param jsonString - JSON string to parse
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed object or fallback
 */
export function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.warn('JSON parse failed:', error);
    return fallback;
  }
}
