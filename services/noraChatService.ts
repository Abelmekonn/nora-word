/**
 * noraChatService.ts
 *
 * Purpose: Provides a simple interface for the nora-word frontend to communicate
 * with the nora-ai backend via the nora-chat Edge Function.
 *
 * This service handles:
 * - Calling the nora-chat Edge Function
 * - Error handling and response parsing
 * - Workspace context management
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Response type from nora-chat Edge Function
 */
export interface NoraChatResponse {
  success: boolean;
  answer?: string;
  type?: string;
  error?: string;
  details?: string;
  rawResult?: Record<string, unknown>;
}

// Cache for workspace ID to avoid repeated queries
let cachedWorkspaceId: string | null = null;
let cachedUserId: string | null = null;

/**
 * Get the current workspace ID from user profile
 * Uses caching to avoid repeated Supabase queries
 */
async function getCurrentWorkspaceId(): Promise<string> {
  console.log("[noraChatService] getCurrentWorkspaceId called");

  // Check cache FIRST - return immediately without any Supabase calls
  if (cachedWorkspaceId && cachedUserId) {
    console.log(
      "[noraChatService] Using cached workspaceId:",
      cachedWorkspaceId.substring(0, 8) + "..."
    );
    return cachedWorkspaceId;
  }

  if (!supabase) {
    console.error("[noraChatService] Supabase not configured");
    throw new Error("Supabase not configured");
  }

  console.log("[noraChatService] Getting session (first time, will cache)...");
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  console.log(
    "[noraChatService] User:",
    user?.id ? `${user.id.substring(0, 8)}...` : "null"
  );

  if (!user) {
    console.error("[noraChatService] User not authenticated");
    throw new Error("User not authenticated");
  }

  console.log("[noraChatService] Fetching workspace from profiles...");
  // Try to resolve workspace from profiles.current_workspace_id; fallback to user.id
  const { data: prof } = await supabase
    .from("profiles")
    .select("current_workspace_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const workspaceId = prof?.current_workspace_id || user.id;
  console.log(
    "[noraChatService] Workspace resolved:",
    workspaceId.substring(0, 8) + "..."
  );

  // Cache the results
  cachedWorkspaceId = workspaceId;
  cachedUserId = user.id;

  return workspaceId;
}

/**
 * Helper function to add timeout to a promise
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Ask Nora a question and get an AI-powered response
 *
 * @param question - The user's question or prompt
 * @param language - Optional workspace language ('en', 'fr', 'nl') to ensure AI responds in the correct language
 * @returns Promise<NoraChatResponse> - The AI response
 *
 * @example
 * const response = await askNora("What is inheritance tax in Belgium?", "fr");
 * if (response.success) {
 *   console.log(response.answer);
 * }
 */
export async function askNora(
  question: string,
  language?: string
): Promise<NoraChatResponse> {
  console.log("[noraChatService] askNora called");

  if (!isSupabaseConfigured || !supabase) {
    console.error("[noraChatService] Supabase not configured");
    return {
      success: false,
      error: "Supabase not configured",
      details: "Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY",
    };
  }

  if (
    !question ||
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    console.error("[noraChatService] Invalid question");
    return {
      success: false,
      error: "Invalid question",
      details: "Question must be a non-empty string",
    };
  }

  try {
    console.log("[noraChatService] Step 1: Getting workspace ID...");
    const workspaceId = await withTimeout(
      getCurrentWorkspaceId(),
      10000, // 10 second timeout for workspace query
      "Workspace query timed out"
    );
    console.log(
      "[noraChatService] Step 1 complete. WorkspaceId:",
      workspaceId.substring(0, 8) + "..."
    );

    console.log(
      "[noraChatService] Step 2: Invoking Edge Function nora-chat..."
    );
    const result = await withTimeout(
      supabase.functions.invoke("nora-chat", {
        body: {
          question: question.trim(),
          workspaceId,
          language: language || "en", // Pass workspace language to ensure AI responds in correct language
        },
      }),
      60000, // 60 second timeout for Edge Function call
      "Edge function call timed out"
    );
    const { data, error } = result as { data: any; error: any };
    console.log("[noraChatService] Step 2 complete. Response received.");

    if (error) {
      console.error("[noraChatService] Edge function error:", error);
      return {
        success: false,
        error: error.message || "Edge function failed",
        details: JSON.stringify(error),
      };
    }

    // Handle error response from edge function (HTTP 200 with error in body)
    if (data?.error) {
      console.error(
        "[noraChatService] Edge function returned error in body:",
        data.error
      );
      return {
        success: false,
        error: data.error,
        details: data.details,
      };
    }

    console.log(
      "[noraChatService] Success! Answer length:",
      data?.answer?.length || 0
    );
    return {
      success: data?.success ?? false,
      answer: data?.answer ?? "",
      type: data?.type,
      rawResult: data?.rawResult,
    };
  } catch (err) {
    console.error("[noraChatService] Unexpected error:", err);
    return {
      success: false,
      error: "Unexpected error",
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Clear the cached workspace ID (useful when user switches workspace)
 */
export function clearWorkspaceCache(): void {
  cachedWorkspaceId = null;
  cachedUserId = null;
  console.log("[noraChatService] Workspace cache cleared");
}

/**
 * Check if the nora-chat service is available
 * Useful for UI to show/hide AI features
 */
export function isNoraChatAvailable(): boolean {
  return isSupabaseConfigured;
}
