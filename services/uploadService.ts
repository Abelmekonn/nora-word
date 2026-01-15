import { supabase } from "./supabaseClient";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_MB,
  TOTAL_MAX_FILE_SIZE_MB,
  ModuleKey,
  getAcceptAttributeForModule,
  validateFilesForModule,
  sanitizeFilename,
  getFileExtension,
} from "../config/documentTypes";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const INDEXING_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/launch-workflows-after-indexing-documents-in-knowledge`;
// Configurable bucket name.
// Default matches the actual bucket name in Supabase Storage: "docs-autofills" (with hyphen).
// Can be overridden via VITE_KNOWLEDGE_BUCKET environment variable.
const KNOWLEDGE_BUCKET =
  (import.meta as any).env?.VITE_KNOWLEDGE_BUCKET || "docs-autofills";

export interface UploadedDocMeta {
  id: string;
  bucket: string; // 'docs-autofills'
  filePath: string; // path within the bucket
  name: string;
  size: number;
  mimeType: string;
  extension: string;
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) {
    throw new Error("User not authenticated. Please log in.");
  }
  return session.access_token;
}

async function getWorkspaceAndUserId(): Promise<{
  workspaceId: string;
  userId: string;
}> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("User not authenticated");
  }

  // Try to resolve workspace from profiles.current_workspace_id; fallback to user.id
  // This matches the pattern used in noraChatService and gptWorkerService.
  const { data: prof } = await supabase
    .from("profiles")
    .select("current_workspace_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const workspaceId = prof?.current_workspace_id || user.id;
  return { workspaceId, userId: user.id };
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  // Fallback
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function uploadSingleFileToKnowledge(
  file: File,
  workspaceId: string,
  userId: string
): Promise<UploadedDocMeta> {
  const docId = generateId();
  const safeName = sanitizeFilename(file.name);
  const extension = getFileExtension(safeName);
  const filePath = `${workspaceId}/${userId}/${docId}_${safeName}`;

  const { error } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .upload(filePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });

  if (error) {
    // Make the most common setup issues actionable for users/admins.
    const msg = String(error.message || "");
    if (/bucket not found/i.test(msg) || error.statusCode === 404) {
      throw new Error(
        `Storage bucket "${KNOWLEDGE_BUCKET}" not found. ` +
          `Please check: (1) The bucket exists in Supabase Storage, (2) The bucket name matches exactly (case-sensitive), ` +
          `(3) Or set VITE_KNOWLEDGE_BUCKET in your .env to the correct bucket name. ` +
          `Current bucket name being used: "${KNOWLEDGE_BUCKET}"`
      );
    }
    if (
      error.statusCode === 403 ||
      /row-level security|unauthorized/i.test(msg)
    ) {
      throw new Error(
        `Upload blocked by Storage RLS policy. ` +
          `The bucket "${KNOWLEDGE_BUCKET}" exists but your user doesn't have permission to upload. ` +
          `An admin must add Storage RLS policies (see supabase/migrations_made_by_cursor/2025-12-17_storage_rls_policies.sql). ` +
          `Original error: ${msg}`
      );
    }
    throw new Error(`Failed to upload ${safeName}: ${msg}`);
  }

  return {
    id: docId,
    bucket: KNOWLEDGE_BUCKET,
    filePath,
    name: safeName,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    extension,
  };
}

export async function uploadFilesToKnowledge(
  files: File[],
  module: ModuleKey = "SMART_DRAFTING"
): Promise<{
  uploaded: UploadedDocMeta[];
  indexingLaunched: boolean;
  errors: string[];
}> {
  const validation = validateFilesForModule(files, module);
  if (!validation.ok) {
    return { uploaded: [], indexingLaunched: false, errors: validation.errors };
  }

  const { workspaceId, userId } = await getWorkspaceAndUserId();

  const uploaded: UploadedDocMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const meta = await uploadSingleFileToKnowledge(file, workspaceId, userId);
      uploaded.push(meta);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  let indexingLaunched = false;
  if (uploaded.length > 0) {
    try {
      // Per docs-types-and-upload-cross-modules.mdc: files uploaded to docs_autofills must be indexed.
      // The Edge Function launch-workflows-after-indexing-documents-in-knowledge:
      // - Inserts documents into docs_autofills table (insert_docs_autofills defaults to true)
      // - Launches indexing via index-docs-autofills (launch_indexing defaults to true)
      // - Requires workflows_to_launch to be a non-empty array
      // Since we only need indexing (no additional workflows), we pass a minimal no-op workflow.
      // The Edge Function will handle document insertion and indexing automatically.
      indexingLaunched = await triggerKnowledgeIndexing(
        uploaded,
        workspaceId,
        userId,
        [
          {
            // Minimal workflow entry - required by backend but won't be executed since we only need indexing
            // If you have a specific workflow to run after indexing, replace this with the actual ef_function_name and ef_body
            ef_function_name: "no-op", // Placeholder - replace with actual workflow if needed
            ef_body: {
              // Minimal payload - the Edge Function will add user_id automatically
              workspace_id: workspaceId,
            },
          },
        ]
      );
    } catch (e) {
      // Do not hard fail; surface the error with full details
      const errorMsg =
        e instanceof Error ? e.message : "Failed to trigger indexing";
      errors.push(errorMsg);
      // Files are still uploaded to Storage even if indexing fails
    }
  }

  return { uploaded, indexingLaunched, errors };
}

export async function triggerKnowledgeIndexing(
  uploadedDocs: UploadedDocMeta[],
  workspaceId?: string,
  requesterUserId?: string,
  workflowsToLaunch?: Record<string, any> | any[]
): Promise<boolean> {
  const token = await getAccessToken();
  let ws = workspaceId;
  let userId = requesterUserId;
  if (!ws || !userId) {
    const ids = await getWorkspaceAndUserId();
    ws = ids.workspaceId;
    userId = ids.userId;
  }

  const payload = {
    workspaceId: ws, // Backend accepts both workspaceId and workspace_id
    requesterUserId: userId, // Not used by backend, but kept for consistency
    documents: uploadedDocs.map((d) => ({
      id: d.id, // Required: document ID (must match the id used in docs_autofills)
      name: d.name, // Required: document name
      file_path: d.filePath, // Required: path within bucket (snake_case)
      size_bytes: d.size, // Required: file size in bytes (must be >= 0)
      // Backend doesn't use bucket, mimeType, or extension from documents array
      // These are handled automatically based on file_path
    })),
    // Backend requires workflows_to_launch to be a non-empty array.
    // Each workflow must have:
    // - ef_function_name: Edge Function name to call after indexing completes
    // - ef_body: JSON payload for that Edge Function (user_id will be added automatically)
    // Since we only need indexing (no additional workflows), we pass a minimal workflow.
    workflows_to_launch:
      workflowsToLaunch !== undefined &&
      Array.isArray(workflowsToLaunch) &&
      workflowsToLaunch.length > 0
        ? workflowsToLaunch
        : [
            {
              ef_function_name: "no-op", // Placeholder - replace with actual workflow if needed
              ef_body: { workspace_id: ws },
            },
          ],
    // Optional: these default to true, so we don't need to specify them
    // launch_indexing: true, // Default: launches index-docs-autofills
    // insert_docs_autofills: true, // Default: inserts documents into docs_autofills table
  };

  const response = await fetch(INDEXING_FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Try to parse JSON error response for clearer error messages
    let errorMessage = `Indexing function failed (${response.status})`;
    let errorDetails = "";
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === "string") {
        errorMessage = errorData;
      }
      // Include additional error details if available
      if (errorData.details) {
        errorDetails = ` Details: ${JSON.stringify(errorData.details)}`;
      } else if (errorData.hint) {
        errorDetails = ` Hint: ${errorData.hint}`;
      }
      // If the error mentions workflows, include the payload structure for debugging
      if (/workflow/i.test(errorMessage)) {
        errorDetails += ` Payload workflows_to_launch: ${JSON.stringify(
          workflowsToLaunch || []
        )}`;
      }
    } catch {
      // If JSON parsing fails, try text
      const text = await response.text().catch(() => "");
      if (text) {
        errorMessage = text;
      }
    }
    throw new Error(`${errorMessage}${errorDetails}`);
  }

  return true;
}

export function getAcceptForSmartDrafting(): string {
  return getAcceptAttributeForModule("SMART_DRAFTING");
}

export const SMART_DRAFTING_LIMITS = {
  allowedExtensions: ALLOWED_EXTENSIONS.SMART_DRAFTING,
  maxFileSizeMb: MAX_FILE_SIZE_MB.SMART_DRAFTING,
  totalMaxFileSizeMb: TOTAL_MAX_FILE_SIZE_MB.SMART_DRAFTING,
};
