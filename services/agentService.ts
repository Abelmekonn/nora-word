import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { Agent } from "../types";
import { addToHistory } from "./dataService";
import { PLAYBOOKS } from "../constants";

/**
 * Agent Service
 *
 * Explicitly requested by the user (plan):
 * - Provide CRUD for Agents persisted to Supabase with workspace scoping and soft-delete
 * - The UI will use these methods to list/create/update/delete agents
 *
 * Design choices (assistant decision, explained):
 * - We resolve the "workspace" as the current authenticated user's id (same interim approach
 *   used elsewhere in the app). This keeps behavior consistent while a fuller workspace model
 *   is wired across the app.
 * - We include a graceful fallback to constants-based PLAYBOOKS by converting them to Agent
 *   objects if the database table doesn't exist or returns an error. This mirrors existing
 *   patterns in dataService for a smooth first-run experience.
 */

type NewAgentInput = {
  name: string;
  description?: string;
  rules?: string[];
  systemPrompt?: string;
  model?: string;
  tools?: any[];
};

type UpdateAgentInput = Partial<NewAgentInput>;

async function getWorkspaceAndUserId(): Promise<{
  workspaceId: string | null;
  userId: string | null;
}> {
  /**
   * Assistant decision: Guard against missing Supabase config or runtime auth errors.
   * If anything fails, return nulls so callers can gracefully fall back.
   */
  if (!isSupabaseConfigured) {
    return { workspaceId: null, userId: null };
  }
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const workspaceId = userId; // Interim: use user.id as workspace id, consistent with other services
    return { workspaceId, userId };
  } catch {
    return { workspaceId: null, userId: null };
  }
}

/**
 * listAgents
 * Returns all non-deleted agents for the current workspace (newest first).
 * If the table is missing or RLS blocks access, returns a fallback list converted from PLAYBOOKS.
 */
export async function listAgents(): Promise<Agent[]> {
  /**
   * Assistant decision: Wrap all logic in try/catch.
   * Any exception should degrade to local PLAYBOOKS to keep UX smooth.
   */
  try {
    const { workspaceId, userId } = await getWorkspaceAndUserId();
    if (!workspaceId || !userId) return convertPlaybooksToAgents();

    // Ensure user has an active session before calling Edge Function
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.warn("[listAgents] No active session, falling back to playbooks");
      return convertPlaybooksToAgents();
    }

    // Use supabase.functions.invoke() with authenticated client
    const { data, error } = await supabase.functions.invoke(
      "word-agents-management",
      {
        body: {
          action: "list",
          workspaceId,
        },
      }
    );

    if (error) {
      console.error("[listAgents] Edge Function error:", error);
      return convertPlaybooksToAgents();
    }

    if (!data?.success || !Array.isArray(data.data)) {
      console.warn(
        "[listAgents] Invalid response format, falling back to playbooks"
      );
      return convertPlaybooksToAgents();
    }
    return data.data.map(rowToAgent);
  } catch (e: any) {
    console.error("[listAgents] Exception:", e);
    return convertPlaybooksToAgents();
  }
}

/**
 * createAgent
 * Inserts a new agent row and records a history event.
 */
export async function createAgent(input: NewAgentInput): Promise<Agent | null> {
  const { workspaceId, userId } = await getWorkspaceAndUserId();
  if (!workspaceId || !userId) return null;

  // Ensure user has an active session before calling Edge Function
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) {
    console.error("[createAgent] No active session");
    return null;
  }

  const agentData = {
    name: input.name?.trim(),
    description: input.description?.trim() || null,
    rules: Array.isArray(input.rules) ? input.rules : [],
    system_prompt: input.systemPrompt || null,
    model: input.model || "gpt-4o",
    tools: Array.isArray(input.tools) ? input.tools : [],
  };

  // Use supabase.functions.invoke() with authenticated client
  const { data, error } = await supabase.functions.invoke(
    "word-agents-management",
    {
      body: {
        action: "create",
        workspaceId,
        agentData,
      },
    }
  );

  if (error) {
    console.error("[createAgent] Edge Function error:", error);
    return null;
  }

  if (!data?.success || !data.data) {
    console.warn("[createAgent] Invalid response format");
    return null;
  }

  await addToHistory(
    "AGENT_CREATED",
    agentData.name || "Unnamed Agent",
    "Created a new agent",
    { agentId: data.data.id }
  );
  return rowToAgent(data.data);
}

/**
 * updateAgent
 * Updates the agent with partial fields and records a history event.
 */
export async function updateAgent(
  agentId: string,
  updates: UpdateAgentInput
): Promise<Agent | null> {
  const { workspaceId, userId } = await getWorkspaceAndUserId();
  if (!workspaceId || !userId) return null;

  // Ensure user has an active session before calling Edge Function
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) {
    console.error("[updateAgent] No active session");
    return null;
  }

  const agentData: any = {};
  if (typeof updates.name === "string") agentData.name = updates.name.trim();
  if (typeof updates.description === "string")
    agentData.description = updates.description.trim();
  if (Array.isArray(updates.rules)) agentData.rules = updates.rules;
  if (typeof updates.systemPrompt === "string")
    agentData.system_prompt = updates.systemPrompt;
  if (typeof updates.model === "string") agentData.model = updates.model;
  if (Array.isArray(updates.tools)) agentData.tools = updates.tools;

  // Use supabase.functions.invoke() with authenticated client
  const { data, error } = await supabase.functions.invoke(
    "word-agents-management",
    {
      body: {
        action: "update",
        workspaceId,
        agentId,
        agentData,
      },
    }
  );

  if (error) {
    console.error("[updateAgent] Edge Function error:", error);
    return null;
  }

  if (!data?.success || !data.data) {
    console.warn("[updateAgent] Invalid response format");
    return null;
  }

  await addToHistory(
    "AGENT_UPDATED",
    data.data.name || "Agent",
    "Updated an agent",
    { agentId: data.data.id }
  );
  return rowToAgent(data.data);
}

/**
 * softDeleteAgent
 * Soft-deletes the agent and records a history event.
 */
export async function softDeleteAgent(agentId: string): Promise<boolean> {
  const { workspaceId, userId } = await getWorkspaceAndUserId();
  if (!workspaceId || !userId) return false;

  // Ensure user has an active session before calling Edge Function
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) {
    console.error("[softDeleteAgent] No active session");
    return false;
  }

  // Use supabase.functions.invoke() with authenticated client
  const { data, error } = await supabase.functions.invoke(
    "word-agents-management",
    {
      body: {
        action: "delete",
        workspaceId,
        agentId,
      },
    }
  );

  if (error) {
    console.error("[softDeleteAgent] Edge Function error:", error);
    return false;
  }

  if (!data?.success || !data.data) {
    console.warn("[softDeleteAgent] Invalid response format");
    return false;
  }

  await addToHistory(
    "AGENT_DELETED",
    data.data.name || "Agent",
    "Deleted an agent",
    { agentId }
  );
  return true;
}

// ---------- Helpers ----------

function rowToAgent(row: any): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rules: Array.isArray(row.rules) ? row.rules : [],
    systemPrompt: row.system_prompt ?? undefined,
    model: row.model ?? undefined,
    tools: Array.isArray(row.tools) ? row.tools : undefined,
  };
}

function convertPlaybooksToAgents(): Agent[] {
  return PLAYBOOKS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    rules: Array.isArray(p.rules) ? p.rules : [],
    systemPrompt: undefined,
    model: "gpt-4o",
    tools: [],
  }));
}
