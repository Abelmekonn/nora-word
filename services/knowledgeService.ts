import { supabase } from "./supabaseClient";
import { extractTextFromSupabaseStorage } from "../utils/textExtraction";

export type KnowledgeStatus = "ready" | "processing" | "error" | string;

export interface KnowledgeDoc {
  id: string;
  name: string;
  file_path: string;
  extension?: string;
  mime_type?: string;
  status?: KnowledgeStatus;
  created_at?: string;
  workspace_id?: string;
  user_id?: string;
}

/**
 * deriveExtension
 * Choice by assistant: The backend schema may not always provide an "extension" column.
 * We derive a best-effort extension from the stored filename/path so UI can still display
 * "PDF/DOC" badges without requiring a DB column.
 */
function deriveExtension(
  doc: Pick<KnowledgeDoc, "name" | "file_path">
): string | undefined {
  const candidate = (doc.name || doc.file_path || "").toString();
  const lastDot = candidate.lastIndexOf(".");
  if (lastDot >= 0 && lastDot < candidate.length - 1) {
    return candidate.slice(lastDot + 1).toLowerCase();
  }
  return undefined;
}

async function getUserAndWorkspace(): Promise<{
  userId: string;
  workspaceId: string;
}> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("User not authenticated");
  }

  // Try to resolve workspace from profiles.current_workspace_id; fallback to user.id
  // This matches the pattern used in uploadService, noraChatService, and gptWorkerService.
  const { data: prof } = await supabase
    .from("profiles")
    .select("current_workspace_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const workspaceId = prof?.current_workspace_id || user.id;
  return { userId: user.id, workspaceId };
}

export async function fetchKnowledgeDocs(options?: {
  statusList?: KnowledgeStatus[];
}): Promise<{ docs: KnowledgeDoc[]; error: string | null }> {
  try {
    const { workspaceId } = await getUserAndWorkspace();
    const statuses =
      options?.statusList && options.statusList.length > 0
        ? options.statusList
        : ["ready", "processing"];

    let query = supabase
      .from("docs_autofills")
      // IMPORTANT: do not select "extension" here unless the DB schema guarantees it exists.
      // The missing column caused 400 errors and made the Knowledge Base list look empty.
      .select(
        // NOTE: Some environments also don't have "mime_type". Keep the select minimal.
        // NOTE: Some environments don't have "user_id". Prefer workspace_id isolation.
        "id,name,file_path,status,created_at,workspace_id"
      )
      .eq("workspace_id", workspaceId)
      .in("status", statuses as string[])
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.warn("fetchKnowledgeDocs error:", error.message);
      return { docs: [], error: error.message };
    }
    const docs = ((data || []) as KnowledgeDoc[]).map((d) => ({
      ...d,
      extension: d.extension ?? deriveExtension(d),
    }));
    return { docs, error: null };
  } catch (e) {
    console.warn("fetchKnowledgeDocs exception:", e);
    return { docs: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fetch the text content of a Knowledge Base document
 *
 * Strategy:
 * 1. First, try to read from database `content` column (if external API populated it)
 * 2. If not available, fall back to client-side extraction from Storage
 *
 * This ensures we can display content even if the external API hasn't saved it yet.
 */
export async function fetchKnowledgeDocContent(
  doc: KnowledgeDoc
): Promise<{ content: string; error: string | null }> {
  try {
    // STEP 1: Try to read extracted content from database (preferred - faster)
    // External API should populate this during indexing
    const { data: dbData, error: dbError } = await supabase
      .from("docs_autofills")
      .select("content, status")
      .eq("id", doc.id)
      .single();

    // If content exists in database, use it (fastest path)
    if (!dbError && dbData?.content && dbData.content.trim().length > 0) {
      return { content: dbData.content, error: null };
    }

    // STEP 2: Fallback to client-side extraction from Storage
    // This handles cases where:
    // - External API hasn't populated content yet
    // - Content column is empty
    // - We need to extract on-demand
    console.log(
      `[fetchKnowledgeDocContent] Content not in DB for ${doc.id}, extracting from Storage...`
    );

    const KNOWLEDGE_BUCKET =
      (import.meta as any).env?.VITE_KNOWLEDGE_BUCKET || "docs-autofills";

    // Extract text from Storage using client-side extraction
    const extractedText = await extractTextFromSupabaseStorage(
      supabase,
      KNOWLEDGE_BUCKET,
      doc.file_path,
      doc.name || doc.file_path.split("/").pop() || "document",
      3600 // 1 hour expiration
    );

    return { content: extractedText, error: null };
  } catch (e) {
    console.warn("fetchKnowledgeDocContent exception:", e);
    const errorMessage =
      e instanceof Error
        ? e.message
        : "Unknown error during content extraction";

    // Provide helpful error messages based on the failure
    if (errorMessage.includes("Failed to load PDF.js")) {
      return {
        content: "",
        error:
          "PDF extraction library failed to load. Please refresh the page.",
      };
    }
    if (errorMessage.includes("Failed to load mammoth")) {
      return {
        content: "",
        error:
          "DOCX extraction library failed to load. Please refresh the page.",
      };
    }
    if (errorMessage.includes("Unsupported file type")) {
      return {
        content: "",
        error: `File type not supported for extraction: ${
          doc.extension || "unknown"
        }`,
      };
    }

    return { content: "", error: errorMessage };
  }
}
