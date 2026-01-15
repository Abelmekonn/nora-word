/**
 * Supabase Edge Function: translate
 *
 * Acts as a proxy between nora-word frontend and the nora-ai Python backend's
 * /translate endpoint.
 *
 * Handles:
 * - Authentication and authorization
 * - Forwarding translation request to nora-ai backend
 * - Returning translated text and detected source language
 * 
 * User request: Follow same pattern as improve-writing Edge Function.
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
  console.log(`[translate][${rid}] Request start`, { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      console.warn(`[translate][${rid}] Invalid method`, { method: req.method });
      return json({ error: "Method not allowed" }, 405);
    }

    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(`[translate][${rid}] Missing Authorization header`);
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
      console.warn(`[translate][${rid}] Auth failed`, { error: userError?.message });
      return json({ error: "Unable to authenticate user" }, 401);
    }

    // Parse request body
    const body = await req.json().catch(() => null) as {
      text?: string;
      targetLang?: string;
      guidelines?: string;
      workspace_id?: string | null;
    } | null;

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { text, targetLang, guidelines, workspace_id } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return json({ error: "Missing or invalid 'text' (must be a non-empty string)" }, 400);
    }

    if (!targetLang || typeof targetLang !== "string" || targetLang.trim().length === 0) {
      return json({ error: "Missing or invalid 'targetLang' (must be a non-empty string)" }, 400);
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
        console.warn(`[translate][${rid}] User not in workspace`);
        return json({ error: "User not in workspace" }, 403);
      }
    }

    // Call nora-ai backend
    // TODO: Replace with Deno.env.get("NORA_AI_URL") after deployment
    const NORA_AI_URL = Deno.env.get("NORA_AI_URL") || "https://nora-word-ai-503234474366.europe-west1.run.app";

    console.log(`[translate][${rid}] Calling nora-ai backend`, { targetLang });

    const response = await fetch(`${NORA_AI_URL}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true" // Bypass ngrok browser warning
      },
      body: JSON.stringify({
        text: text,
        target_lang: targetLang,
        guidelines: guidelines || null
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error(`[translate][${rid}] Backend error:`, result.error || response.statusText);
      return json({
        error: result.error || "Translation failed in backend",
        details: result.details || response.statusText
      }, response.status);
    }

    // Validate response shape
    if (!result.translation || typeof result.translation !== "string") {
      console.error(`[translate][${rid}] Invalid response shape from backend`);
      return json({ error: "Invalid response from backend: missing 'translation'" }, 500);
    }

    console.log(`[translate][${rid}] Success`, { 
      sourceLanguage: result.source_language,
      translatedLength: result.translation.length 
    });
    
    return json({
      translatedText: result.translation,
      sourceLanguage: result.source_language || "auto",
      success: true
    });

  } catch (err) {
    console.error(`[translate][${rid}] Unexpected error`, err);
    return json({ error: "Unexpected error", details: String(err) }, 500);
  }
});

