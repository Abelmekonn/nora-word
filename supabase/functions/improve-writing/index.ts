/**
 * Supabase Edge Function: improve-writing
 *
 * Acts as a proxy between nora-word frontend and the nora-ai Python backend's
 * /improve-writing endpoint.
 *
 * Handles:
 * - Authentication and authorization
 * - Forwarding improve writing request to nora-ai backend
 * - Returning rewritten text, explanation, and diff markup
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
  console.log(`[improve-writing][${rid}] Request start`, { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      console.warn(`[improve-writing][${rid}] Invalid method`, { method: req.method });
      return json({ error: "Method not allowed" }, 405);
    }

    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(`[improve-writing][${rid}] Missing Authorization header`);
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
      console.warn(`[improve-writing][${rid}] Auth failed`, { error: userError?.message });
      return json({ error: "Unable to authenticate user" }, 401);
    }

    // Parse request body
    const body = await req.json().catch(() => null) as {
      selection?: string;
      workspace_id?: string | null;
    } | null;

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { selection, workspace_id } = body;

    if (!selection || typeof selection !== "string" || selection.trim().length === 0) {
      return json({ error: "Missing or invalid 'selection' (must be a non-empty string)" }, 400);
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
        console.warn(`[improve-writing][${rid}] User not in workspace`);
        return json({ error: "User not in workspace" }, 403);
      }
    }

    // Call nora-ai backend
    // TODO: Replace with Deno.env.get("NORA_AI_URL") after deployment
    const NORA_AI_URL = Deno.env.get("NORA_AI_URL") || "https://nora-word-ai-503234474366.europe-west1.run.app";

    console.log(`[improve-writing][${rid}] Calling nora-ai backend`);

    const response = await fetch(`${NORA_AI_URL}/improve-writing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true" // Bypass ngrok browser warning
      },
      body: JSON.stringify({ text: selection })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error(`[improve-writing][${rid}] Backend error:`, result.error || response.statusText);
      return json({
        error: result.error || "Improve writing failed in backend",
        details: result.details || response.statusText
      }, response.status);
    }

    // Validate response shape
    if (!result.rewrittenText || typeof result.rewrittenText !== "string") {
      console.error(`[improve-writing][${rid}] Invalid response shape from backend`);
      return json({ error: "Invalid response from backend: missing 'rewrittenText'" }, 500);
    }

    console.log(`[improve-writing][${rid}] Success`);
    return json({
      rewrittenText: result.rewrittenText,
      explanation: result.explanation || "Improved text clarity",
      diffMarkup: result.diffMarkup || result.rewrittenText,
    });

  } catch (err) {
    console.error(`[improve-writing][${rid}] Unexpected error`, err);
    return json({ error: "Unexpected error", details: String(err) }, 500);
  }
});
