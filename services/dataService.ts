import { supabase } from "./supabaseClient";
import { Playbook, ImprovementResult } from "../types";
import { PLAYBOOKS, MOCK_REFERENCE_DOCS } from "../constants";

export interface HistoryItem {
  id: string;
  action_type: string;
  title: string;
  description: string;
  created_at: string;
  /**
   * Explicit per user request: include metadata on history items.
   * Reasoning (assistant's decision): history metadata will carry contextual ids,
   * like the chat session/thread id used to reload conversations.
   */
  metadata?: {
    chat_session_id?: string;
    improvement?: ImprovementResult;
  } | null;
}

export interface ReferenceDoc {
  id: string;
  name: string;
  type: string;
  content: string;
  doc_date: string;
}

// Helper to resolve the current workspace context.
// Explicit per user request: chat sessions/messages are workspace-scoped and protected by RLS.
// Reasoning (assistant's decision): align workspace resolution with existing services
// (`gptWorkerService` / `noraChatService`) by using profiles.current_workspace_id first.
const getWorkspaceId = async (): Promise<string | null> => {
  try {
    // Use getSession instead of getUser to avoid hanging during auth state transitions
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    if (!userId) return null;

    // Try to resolve workspace from profiles.current_workspace_id; fallback to userId.
    // NOTE: Some environments don't have a users_workspaces_map row for the resolved workspace.
    // In that case, chat session inserts will fail with RLS. We detect that and safely fall back
    // to the user's personal workspace id (userId), which can be allowed by policy.
    const { data: prof } = await supabase
      .from("profiles")
      .select("current_workspace_id")
      .eq("auth_user_id", userId)
      .maybeSingle();

    const resolvedWorkspaceId: string =
      (prof as any)?.current_workspace_id || userId;

    // If the resolved workspace is the user's id, it's always safe to return.
    if (resolvedWorkspaceId === userId) return resolvedWorkspaceId;

    // Otherwise, confirm membership exists in users_workspaces_map; if not, fall back.
    const { data: membership, error: membershipErr } = await supabase
      .from("users_workspaces_map")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("workspace_id", resolvedWorkspaceId)
      .maybeSingle();

    if (membershipErr) {
      console.warn(
        "getWorkspaceId: membership check failed, falling back to personal workspace:",
        membershipErr
      );
      return userId;
    }

    return membership?.workspace_id ? resolvedWorkspaceId : userId;
  } catch (err) {
    console.error("getWorkspaceId failed:", err);
    return null;
  }
};

export const fetchHistory = async (): Promise<HistoryItem[]> => {
  // We resolve workspace id from profile first; however, some users expect to see
  // their "personal workspace" history (workspace_id = auth.uid()) as well.
  // Explicit per user request: ensure History isn't empty due to workspace mismatch.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;
  const workspaceId = await getWorkspaceId();
  console.log("📦 fetchHistory: workspaceId =", workspaceId);
  console.log(
    "📦 fetchHistory: workspaceId =",
    workspaceId,
    "userId =",
    userId
  );

  if (!workspaceId) {
    console.warn("⚠️ fetchHistory: No workspaceId, returning empty array");
    return [];
  }

  const baseQuery = () =>
    supabase
      .from("word-history")
      // Explicit per user request: also select metadata containing session/thread ids
      .select("id, action_type, title, description, created_at, metadata")
      .is("deleted_dt", null)
      .order("created_at", { ascending: false });

  // 1) Try resolved workspace first
  console.log(
    "🔍 fetchHistory: Querying word-history table for workspace:",
    workspaceId
  );
  const { data: primaryData, error: primaryError } = await baseQuery().eq(
    "workspace_id",
    workspaceId
  );

  if (!primaryError && primaryData && primaryData.length > 0) {
    console.log("✅ fetchHistory: Success, got", primaryData.length, "items");
    return primaryData;
  }

  if (primaryError) {
    console.error("❌ fetchHistory: Error (primary workspace):", primaryError);
  } else {
    console.log("ℹ️ fetchHistory: No rows for primary workspace");
  }

  // 2) Fallback: personal workspace (auth.uid()) if different
  if (userId && userId !== workspaceId) {
    console.log("🔁 fetchHistory: Falling back to personal workspace:", userId);
    const { data: fallbackData, error: fallbackError } = await baseQuery().eq(
      "workspace_id",
      userId
    );

    if (fallbackError) {
      console.error(
        "❌ fetchHistory: Error (personal workspace fallback):",
        fallbackError
      );
      return [];
    }

    // Merge + de-dupe by id if both return rows
    const merged = [...(primaryData ?? []), ...(fallbackData ?? [])];
    const uniqById = Array.from(
      new Map(merged.map((r: any) => [r.id, r])).values()
    );
    console.log(
      "✅ fetchHistory: Returning",
      uniqById.length,
      "items after fallback merge"
    );
    return uniqById;
  }

  // If we get here, either there was an error or there were simply no rows.
  return primaryData ?? [];
};

export const addToHistory = async (
  actionType: string,
  title: string,
  description: string,
  metadata?: any
): Promise<{ ok: true } | { ok: false; error: unknown }> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getWorkspaceId();
  if (!user || !workspaceId)
    return { ok: false, error: new Error("Missing user or workspaceId") };

  // Helper: perform the insert with a given workspace_id.
  // Explicit per user request: chat activity must appear in History.
  // Reasoning (assistant's decision): try the resolved workspace first, then fall back
  // to the user's personal workspace (auth.uid()) when RLS/membership is misconfigured.
  const tryInsert = async (wsId: string) => {
    return await supabase.from("word-history").insert([
      {
        workspace_id: wsId,
        user_id: user.id,
        action_type: actionType,
        title: title,
        description: description,
        metadata: metadata ?? {},
      },
    ]);
  };

  // 1) Attempt insert into the resolved workspace id
  const { error: primaryErr } = await tryInsert(workspaceId);
  if (!primaryErr) return { ok: true };

  console.error("Error adding to history (primary workspace):", primaryErr);

  // 2) Fallback insert into personal workspace (auth.uid) if different
  if (workspaceId !== user.id) {
    const { error: fallbackErr } = await tryInsert(user.id);
    if (!fallbackErr) return { ok: true };
    console.error(
      "Error adding to history (personal workspace fallback):",
      fallbackErr
    );
    return { ok: false, error: fallbackErr };
  }

  return { ok: false, error: primaryErr };
};

/**
 * ChatMessage
 * Explicit per user request: model for chat messages retrieved by session id.
 * Reasoning (assistant's decision): keep the raw DB shape and map to UI model
 * in the consumer to avoid coupling data layer to UI concerns.
 */
export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

/**
 * ChatSession
 * Explicit per user request: Option B schema (sessions + messages).
 * Reasoning (assistant's decision): keep the minimal shape needed by the client
 * to create a session and then append messages to it.
 */
export interface ChatSession {
  id: string;
  workspace_id: string;
  created_by: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  deleted_dt: string | null;
}

/**
 * fetchChatMessages
 * Explicit per user request: fetch messages for a given chat session/thread id.
 * Reasoning (assistant's decision): ordered by created_at asc to reconstruct
 * the conversation in the correct sequence.
 */
export async function fetchChatMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("word_chat_messages")
    .select("id, session_id, role, content, created_at")
    .eq("session_id", sessionId)
    .is("deleted_dt", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching chat messages:", error);
    return [];
  }
  return data ?? [];
}

/**
 * createChatSession
 * Explicit per user request: create a new chat session row (Option B).
 * Reasoning (assistant's decision): the session id is what we store into
 * `word-history.metadata.chat_session_id` so History clicks can reload messages.
 */
export async function createChatSession(
  title?: string | null
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getWorkspaceId();
  if (!user || !workspaceId) return null;

  const { data, error } = await supabase
    .from("word_chat_sessions")
    .insert([
      {
        workspace_id: workspaceId,
        created_by: user.id,
        title: title ?? null,
      },
    ])
    .select("id")
    .single();

  if (error) {
    console.error("Error creating chat session:", error);
    return null;
  }

  return (data as { id: string } | null)?.id ?? null;
}

/**
 * saveChatMessage
 * Explicit per user request: persist chat messages (Option B).
 * Reasoning (assistant's decision): messages must be stored for History → reload.
 */
export async function saveChatMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  meta?: Record<string, unknown>
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getWorkspaceId();
  if (!user || !workspaceId) return;

  const { error } = await supabase.from("word_chat_messages").insert([
    {
      session_id: sessionId,
      workspace_id: workspaceId,
      created_by: user.id,
      role,
      content,
      meta: meta ?? {},
    },
  ]);

  if (error) {
    console.error("Error saving chat message:", error);
  }
}

export const fetchReferenceDocs = async (): Promise<ReferenceDoc[]> => {
  const { data, error } = await supabase
    .from("word-reference-docs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(
      "Error fetching reference docs (using fallback):",
      error.message
    );
    // Fallback to constants if DB table is missing
    return MOCK_REFERENCE_DOCS.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      content: d.content,
      doc_date: d.date,
    }));
  }
  return data || [];
};

export const fetchPlaybooks = async (): Promise<Playbook[]> => {
  // Assistant decision (explicit per user request): The `word-playbooks` table was removed.
  // We now rely entirely on the local PLAYBOOKS constant to feed the Agents/Playbooks UI.
  // This avoids 404s from Supabase and keeps the UX consistent with the requested design.
  return PLAYBOOKS;
};

/**
 * resolveAvatarUrl
 * Explicit request from the user: Helper to compute a usable URL for user avatars.
 * Reasoning: Avatars may be stored either as a direct HTTPS URL or a Supabase Storage path.
 * This helper normalizes both cases so UI components can simply consume a final URL.
 *
 * Behavior:
 * - If the provided path is already an http(s) URL, it returns it as-is.
 * - Otherwise, it treats the value as a "bucket/path" storage reference (or defaults to "public-bucket").
 *   It returns a public URL using Supabase Storage's getPublicUrl. This matches the current design where
 *   avatar images are expected to be stored in public buckets (e.g., public-bucket, client-website-img).
 * - If the input is empty or a URL cannot be computed, it returns null so callers can fallback gracefully.
 */
export function resolveAvatarUrl(rawPath?: string | null): string | null {
  // Guard: nothing to resolve
  if (!rawPath) return null;
  const trimmed = String(rawPath).trim();
  if (trimmed.length === 0) return null;

  // Case 1: Already a fully qualified URL -> return as-is
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Case 2: Storage reference "bucket/path/in/bucket"
  // If no bucket is provided, default to "public-bucket" per our plan.
  let bucket = "public-bucket";
  let objectPath = trimmed;
  const firstSlashIdx = trimmed.indexOf("/");
  if (firstSlashIdx > 0) {
    bucket = trimmed.slice(0, firstSlashIdx);
    objectPath = trimmed.slice(firstSlashIdx + 1);
  }

  if (!objectPath) return null;

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data?.publicUrl ?? null;
}
