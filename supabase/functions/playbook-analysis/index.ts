/**
 * Supabase Edge Function: playbook-analysis
 *
 * Acts as a proxy between nora-word frontend and the nora-ai Python backend's
 * /playbook-analysis endpoint.
 *
 * Handles:
 * - Authentication and authorization
 * - Forwarding playbook analysis request to nora-ai backend
 * - Returning suggestions array for document compliance
 * 
 * User request: Migrate from legacy Cloud Run worker to nora-ai backend.
 * Follow same pattern as fill-template/index.ts and improve-writing/index.ts.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  const rid = crypto.randomUUID();
  console.log(`[playbook-analysis][${rid}] Request start`, { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      console.warn(`[playbook-analysis][${rid}] Invalid method`, { method: req.method });
      return json({ error: "Method not allowed" }, 405);
    }

    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(`[playbook-analysis][${rid}] Missing Authorization header`);
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: user, error: userError } = await supabase.auth.getUser(token);
    const userId = user?.user?.id;

    if (userError || !userId) {
      console.warn(`[playbook-analysis][${rid}] Auth failed`, { error: userError?.message });
      return json({ error: "Unable to authenticate user" }, 401);
    }

    // Parse request body
    const body = await req.json().catch(() => null) as {
      content?: string;
      rules?: string[];
      system_prompt?: string;
      workspace_id?: string | null;
    } | null;

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { content, rules, system_prompt, workspace_id } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return json({ error: "Missing or invalid 'content' (must be a non-empty string)" }, 400);
    }

    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return json({ error: "Missing or invalid 'rules' (must be a non-empty array of strings)" }, 400);
    }

    // Optional workspace validation
    if (workspace_id) {
      const { data: membership, error: wsErr } = await supabase
        .from('users_workspaces_map')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace_id)
        .maybeSingle();

      if (wsErr || !membership?.workspace_id) {
        console.warn(`[playbook-analysis][${rid}] User not in workspace`);
        return json({ error: "User not in workspace" }, 403);
      }
    }

    // Call nora-ai backend
    // TODO: Replace with Deno.env.get("NORA_AI_URL") after deployment
    const NORA_AI_URL = Deno.env.get("NORA_AI_URL") || "https://nora-word-ai-503234474366.europe-west1.run.app";

    console.log(`[playbook-analysis][${rid}] Calling nora-ai backend`, { rulesCount: rules.length });

    const response = await fetch(`${NORA_AI_URL}/playbook-analysis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true" // Bypass ngrok browser warning
      },
      body: JSON.stringify({
        content: content,
        rules: rules,
        system_prompt: system_prompt || null
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error(`[playbook-analysis][${rid}] Backend error:`, result.error || response.statusText);
      return json({
        error: result.error || "Playbook analysis failed in backend",
        details: result.details || response.statusText
      }, response.status);
    }

    // Validate response shape - suggestions array is required
    if (!result.suggestions || !Array.isArray(result.suggestions)) {
      console.error(`[playbook-analysis][${rid}] Invalid response shape from backend`);
      return json({ 
        error: "Invalid response from backend: missing 'suggestions' array",
        suggestions: []
      }, 500);
    }

    console.log(`[playbook-analysis][${rid}] Success`, { 
      suggestionsCount: result.suggestions.length 
    });
    
    return json({
      suggestions: result.suggestions,
      success: true
    });

  } catch (err) {
    console.error(`[playbook-analysis][${rid}] Unexpected error`, err);
    return json({ error: "Unexpected error", details: String(err), suggestions: [] }, 500);
  }
});


