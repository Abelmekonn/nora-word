/**
 * Anonymization Service
 * Integrates with Supabase Edge Function for document anonymization
 *
 * Uses the `anonymize-file` Edge function which:
 * - Accepts file uploads to Supabase Storage
 * - Detects sensitive information (names, addresses, dates, etc.)
 * - Returns anonymized text or exports anonymized document
 */

import { supabase } from "./supabaseClient";

// Supabase project configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANONYMIZE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/anonymize-file`;

/**
 * Options for anonymization categories
 */
export interface AnonymizeOptions {
  address: boolean;
  company: boolean;
  date: boolean;
  personName: boolean;
  location: boolean;
  email: boolean;
  website: boolean;
}

/**
 * Request payload for the anonymize-file Edge function
 */
export interface AnonymizeRequest {
  filePath: string;
  workspaceId: string;
  documentId: string;
  sensitiveMapping?: string[];
  forceOCR?: boolean;
  preview_only?: boolean;
  selectedCategories?: string[];
  customTerms?: string[];
}

/**
 * Response from the anonymize-file Edge function
 */
export interface AnonymizeResponse {
  success: boolean;
  mode: "preview" | "export";
  anonymized_text?: string;
  detected_urls?: string[];
  filtered_sensitive_terms?: string[];
  final_sensitive_mapping?: string[];
  used_force_ocr?: boolean;
  error?: string;
  details?: string;
  // Export mode additional fields
  output_url?: string;
  output_path?: string;
}

/**
 * Result of anonymization preview
 */
export interface AnonymizePreviewResult {
  success: boolean;
  anonymizedText: string;
  detectedTerms: string[];
  originalTerms: string[];
  replacements?: { term: string; category: string }[];
  error?: string;
}

/**
 * Convert AnonymizeOptions to category strings for the Edge function
 * Uses ai-toolbox standard category names (lowercase with underscores)
 */
function optionsToCategories(options: AnonymizeOptions): string[] {
  const categories: string[] = [];
  if (options.address) categories.push("addresses");
  if (options.company) categories.push("company_names");
  if (options.date) categories.push("dates");
  if (options.personName) categories.push("names");
  if (options.location) categories.push("addresses"); // locations map to addresses
  if (options.email) categories.push("emails");
  if (options.website) categories.push("urls");
  // Return 'all' if no specific categories selected, or dedupe the list
  return categories.length > 0 ? [...new Set(categories)] : ["all"];
}

/**
 * Upload text content as a DOCX file to Supabase Storage
 * Returns the file path in storage
 */
async function uploadTextAsDocx(
  content: string,
  workspaceId: string,
  documentId: string
): Promise<string> {
  // For simplicity, we'll upload as a text file with .txt extension
  // The Edge function can handle text files directly
  const fileName = `${documentId}_${Date.now()}.txt`;
  // IMPORTANT: Storage RLS expects the first path segment to be the workspace UUID,
  // followed by the creator user id, then a unique document name (and optional folders).
  // This structure change was explicitly requested by the user to fix a 500 error caused
  // by the server trying to cast the first path segment ("sensitive") to UUID.
  // Decision: place "sensitive" after workspaceId/userId to preserve module scoping.
  const userId = await getUserId(); // explicitly fetch the creator user id
  const filePath = `${workspaceId}/${userId}/sensitive/${fileName}`;

  // Convert string to Blob
  const blob = new Blob([content], { type: "text/plain" });

  const { error } = await supabase.storage
    .from("anonymization")
    .upload(filePath, blob, {
      contentType: "text/plain",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload document: ${error.message}`);
  }

  return filePath;
}

/**
 * Get the current session's access token for Edge function authentication
 */
async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error(
      "User not authenticated. Please log in to use anonymization."
    );
  }

  return session.access_token;
}

/**
 * Get the current user's workspace ID
 * For now, we'll use the user ID as workspace ID
 */
async function getWorkspaceId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("User not authenticated");
  }

  // Use user ID as workspace ID (you may want to fetch actual workspace from DB)
  return user.id;
}

/**
 * Get the current authenticated user's ID
 *
 * This helper was added per user request to align storage object keys with RLS expectations:
 * bucket_name/workspace_id/created_by_user_id/unique_doc_name
 * Even if today workspaceId === user.id, keeping both segments explicit preserves the
 * storage path contract and eases future workspace multi-user scenarios.
 */
async function getUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("User not authenticated");
  }
  return user.id;
}

/**
 * Generate a unique document ID
 */
function generateDocumentId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Call the anonymize-file Edge function
 */
async function callAnonymizeFunction(
  request: AnonymizeRequest
): Promise<AnonymizeResponse> {
  const accessToken = await getAccessToken();

  const response = await fetch(ANONYMIZE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anonymization failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Preview anonymization of text content
 * Uses the new anonymize-text Edge Function which routes to nora-ai backend.
 * No file upload needed - sends text directly.
 */
export async function previewAnonymization(
  content: string,
  options: AnonymizeOptions,
  customTerms?: string[]
): Promise<AnonymizePreviewResult> {
  try {
    // Call the new anonymize-text Edge Function directly (no file upload)
    const { data, error } = await supabase.functions.invoke("anonymize-text", {
      body: {
        text: content,
        categories: optionsToCategories(options),
        custom_terms: customTerms || [],
      },
    });

    if (error) {
      console.error("Anonymize Edge Function error:", error);
      return {
        success: false,
        anonymizedText: content,
        detectedTerms: [],
        originalTerms: [],
        error: error.message || "Anonymization preview failed",
      };
    }

    // Handle error response from edge function
    if (data?.error) {
      console.error("Anonymize Edge Function returned error:", data.error);
      return {
        success: false,
        anonymizedText: content,
        detectedTerms: [],
        originalTerms: [],
        error: data.error,
      };
    }

    // Extract detected terms from classified results
    const detectedTerms = (data?.detected_terms || []).map(
      (item: { term: string }) => item.term
    );

    const replacements = (data?.detected_terms || []).map(
      (item: { term: string; category: string }) => ({
        term: item.term,
        category: item.category || "UNKNOWN",
      })
    );

    return {
      success: true,
      anonymizedText: data?.anonymized_text || content,
      detectedTerms: detectedTerms,
      originalTerms: detectedTerms,
      replacements: replacements,
    };
  } catch (error) {
    console.error("Anonymization preview error:", error);
    return {
      success: false,
      anonymizedText: content,
      detectedTerms: [],
      originalTerms: [],
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Anonymize text content using the new anonymize-text Edge Function
 * Routes to nora-ai backend - no file upload needed.
 */
export async function anonymizeText(
  content: string,
  options: AnonymizeOptions,
  sensitiveTerms?: string[],
  customTerms?: string[]
): Promise<string> {
  try {
    // Call the new anonymize-text Edge Function directly (no file upload)
    const { data, error } = await supabase.functions.invoke("anonymize-text", {
      body: {
        text: content,
        categories: optionsToCategories(options),
        custom_terms: customTerms || [],
      },
    });

    if (error) {
      console.error("Anonymize Edge Function error:", error);
      throw new Error(error.message || "Anonymization failed");
    }

    // Handle error response from edge function
    if (data?.error) {
      console.error("Anonymize Edge Function returned error:", data.error);
      throw new Error(data.error);
    }

    return data?.anonymized_text || content;
  } catch (error) {
    console.error("Anonymization error:", error);
    throw error;
  }
}

/**
 * Fallback local anonymization using simple pattern replacement
 * Used when the Edge function is unavailable
 */
export function localAnonymize(
  content: string,
  options: AnonymizeOptions,
  customTerms?: string[]
): string {
  return localAnonymizeWithReplacements(content, options, customTerms)
    .anonymizedText;
}

/**
 * Local anonymization fallback returning replacements
 */
export function localAnonymizeWithReplacements(
  content: string,
  options: AnonymizeOptions,
  customTerms?: string[]
): {
  anonymizedText: string;
  replacements: { term: string; category: string }[];
} {
  let result = content;
  const replacements: { term: string; category: string }[] = [];

  // Helper to process regex
  const processRegex = (
    regex: RegExp,
    category: string,
    placeholder: string
  ) => {
    const matches = [...result.matchAll(regex)];
    for (const match of matches) {
      replacements.push({ term: match[0], category });
    }
    result = result.replace(regex, placeholder);
  };

  // Custom terms replacement
  if (customTerms && customTerms.length > 0) {
    for (const term of customTerms) {
      if (term.trim()) {
        const regex = new RegExp(escapeRegExp(term), "gi");
        processRegex(regex, "CUSTOM", "[REDACTED]");
      }
    }
  }

  // Email pattern
  if (options.email) {
    processRegex(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      "email",
      "[EMAIL]"
    );
  }

  // Website/URL pattern
  if (options.website) {
    processRegex(/https?:\/\/[^\s]+/g, "website", "[URL]");
    processRegex(/www\.[^\s]+/g, "website", "[WEBSITE]");
  }

  // Date patterns (various formats)
  if (options.date) {
    // MM/DD/YYYY or DD/MM/YYYY
    processRegex(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, "date", "[DATE]");
    // Month DD, YYYY
    processRegex(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
      "date",
      "[DATE]"
    );
  }

  // Address pattern
  if (options.address) {
    // Simple address pattern (street, avenue, road, etc.)
    processRegex(
      /\b\d{1,5}\s+([A-Za-z0-9.,\-]+\s)+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Square|Sq|Place|Pl|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Commons|Cmns)\b/gi,
      "address",
      "[ADDRESS]"
    );
  }

  // Location pattern (city, country, state, etc.)
  if (options.location) {
    // Simple location pattern (common city/country/state/region names)
    // This is a naive example; in production, use a more robust NER or list
    processRegex(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(Country|State|Province|Region|City|Town|Village|County)?\b/g,
      "location",
      "[LOCATION]"
    );
  }

  return { anonymizedText: result, replacements };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Default anonymization options
 */
export const DEFAULT_ANONYMIZE_OPTIONS: AnonymizeOptions = {
  address: true,
  company: true,
  date: true,
  personName: true,
  location: true,
  email: true,
  website: true,
};

/**
 * Upload a DOCX file (as base64) to Supabase Storage
 * Returns the file path in storage
 */
export async function uploadDocxFile(
  base64Content: string,
  workspaceId: string,
  documentId: string
): Promise<string> {
  const fileName = `${documentId}_${Date.now()}.docx`;
  // Keep the same storage path contract as for text uploads: workspaceId/userId/sensitive/<file>
  const userId = await getUserId();
  const filePath = `${workspaceId}/${userId}/sensitive/${fileName}`;

  // Convert base64 to Blob
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const { error } = await supabase.storage
    .from("anonymization")
    .upload(filePath, blob, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload document: ${error.message}`);
  }

  return filePath;
}

/**
 * Anonymize a DOCX file using the Supabase Edge function
 * This is for full document anonymization when the document is exported as DOCX
 */
export async function anonymizeDocxFile(
  base64Content: string,
  options: AnonymizeOptions,
  sensitiveTerms?: string[],
  customTerms?: string[]
): Promise<AnonymizeResponse> {
  try {
    const workspaceId = await getWorkspaceId();
    const documentId = generateDocumentId();

    // Upload DOCX to storage
    const filePath = await uploadDocxFile(
      base64Content,
      workspaceId,
      documentId
    );

    // Call Edge function
    const response = await callAnonymizeFunction({
      filePath,
      workspaceId,
      documentId,
      sensitiveMapping: sensitiveTerms,
      selectedCategories: optionsToCategories(options),
      customTerms,
    });

    return response;
  } catch (error) {
    console.error("DOCX anonymization error:", error);
    throw error;
  }
}
