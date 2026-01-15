/**
 * Supabase Edge Function: fill-template
 *
 * Acts as a proxy between nora-word frontend and the nora-ai Python backend's
 * /fill-template endpoint.
 *
 * Handles:
 * - Authentication and authorization
 * - Forwarding fill template request to nora-ai backend
 * - Returning filled document and list of changes
 * 
 * User request: Follow same pattern as translate/index.ts and improve-writing/index.ts.
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
  console.log(`[fill-template][${rid}] Request start`, { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      console.warn(`[fill-template][${rid}] Invalid method`, { method: req.method });
      return json({ error: "Method not allowed" }, 405);
    }

    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(`[fill-template][${rid}] Missing Authorization header`);
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
      console.warn(`[fill-template][${rid}] Auth failed`, { error: userError?.message });
      return json({ error: "Unable to authenticate user" }, 401);
    }

    // Parse request body
    const body = await req.json().catch(() => null) as {
      template?: string;
      reference?: string;
      workspace_id?: string | null;
    } | null;

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { template, reference, workspace_id } = body;

    if (!template || typeof template !== "string" || template.trim().length === 0) {
      return json({ error: "Missing or invalid 'template' (must be a non-empty string)" }, 400);
    }

    if (!reference || typeof reference !== "string" || reference.trim().length === 0) {
      return json({ error: "Missing or invalid 'reference' (must be a non-empty string)" }, 400);
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
        console.warn(`[fill-template][${rid}] User not in workspace`);
        return json({ error: "User not in workspace" }, 403);
      }
    }

    // Call nora-ai backend
    // TODO: Replace with Deno.env.get("NORA_AI_URL") after deployment
    const NORA_AI_URL = Deno.env.get("NORA_AI_URL") || "https://nora-word-ai-503234474366.europe-west1.run.app";

    console.log(`[fill-template][${rid}] Calling nora-ai backend`);

    const response = await fetch(`${NORA_AI_URL}/fill-template`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true" // Bypass ngrok browser warning
      },
      body: JSON.stringify({
        template: template,
        reference: reference
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error(`[fill-template][${rid}] Backend error:`, result.error || response.statusText);
      return json({
        error: result.error || "Fill template failed in backend",
        details: result.details || response.statusText
      }, response.status);
    }

    // Validate response shape
    if (!result.filledDocument || typeof result.filledDocument !== "string") {
      console.error(`[fill-template][${rid}] Invalid response shape from backend`);
      return json({ error: "Invalid response from backend: missing 'filledDocument'" }, 500);
    }

    console.log(`[fill-template][${rid}] Success`, { 
      changesCount: result.changes?.length || 0,
      filledDocLength: result.filledDocument.length 
    });
    
    return json({
      filledDocument: result.filledDocument,
      changes: result.changes || [],
      success: true
    });

  } catch (err) {
    console.error(`[fill-template][${rid}] Unexpected error`, err);
    return json({ error: "Unexpected error", details: String(err) }, 500);
  }
});

