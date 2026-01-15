/**
 * anonymize-text Edge Function
 * 
 * Proxies anonymization requests from the nora-word frontend to the nora-ai backend.
 * Follows the same pattern as nora-chat Edge Function.
 * 
 * Flow: Frontend → This Edge Function → nora-ai /anonymize-text → OpenAI → Response
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: user, error: userError } = await supabase.auth.getUser(token);
    const userId = user?.user?.id;

    if (userError || !userId) {
      return json({ error: "Unable to authenticate user" }, 401);
    }

    // Parse request body
    const body = await req.json().catch(() => null) as {
      text?: string;
      categories?: string[];
      custom_terms?: string[];
      workspace_id?: string;
    } | null;

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { text, categories, custom_terms, workspace_id } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return json({ error: "Missing or invalid 'text' (must be a non-empty string)" }, 400);
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
        console.warn(`[anonymize-text] User not in workspace`);
        return json({ error: "User not in workspace" }, 403);
      }
    }

    // Get nora-ai backend URL
    // TODO: Replace with Deno.env.get("NORA_AI_URL") after deployment
    const NORA_AI_URL = Deno.env.get("NORA_AI_URL") || "https://nora-word-ai-503234474366.europe-west1.run.app";
    

    console.log(`[anonymize-text] Calling nora-ai at ${NORA_AI_URL}/anonymize-text`);

    // Call nora-ai backend
    const response = await fetch(`${NORA_AI_URL}/anonymize-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"  // For local testing with ngrok
      },
      body: JSON.stringify({
        text: text.trim(),
        categories: categories || null,
        custom_terms: custom_terms || null
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      console.error(`[anonymize-text] Backend error: ${response.status} - ${errText}`);
      return json({ 
        error: "Backend request failed", 
        details: errText,
        status_code: response.status 
      }, 500);
    }

    const result = await response.json();

    console.log(`[anonymize-text] Success - detected ${result.detected_terms?.length || 0} terms`);

    return json({
      success: result.success ?? true,
      anonymized_text: result.anonymized_text || text,
      detected_terms: result.detected_terms || [],
      categories_used: result.categories_used || ["all"]
    });

  } catch (err) {
    console.error("[anonymize-text] Unexpected error:", err);
    return json({ 
      error: "Internal error", 
      details: err instanceof Error ? err.message : String(err) 
    }, 500);
  }
});



