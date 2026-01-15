import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/**
 * nora-chat Edge Function
 *
 * Purpose: Routes AI chat requests from nora-word frontend to the nora-ai Python backend.
 * This follows the established ask-ai pattern with JWT auth and workspace validation.
 *
 * Request body:
 *   - question: string (the user's question)
 *   - workspaceId: string (UUID of the workspace)
 *
 * Response:
 *   - success: boolean
 *   - answer: string (the AI response text)
 *   - type: string (the response type from nora-ai)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 405,
      });
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get user JWT from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "User not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Dual-mode auth: client (JWT) vs server (service role)
    const token = authHeader.replace("Bearer ", "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

    const body = await req.json();
    let userId: string | null = null;

    if (token === serviceKey) {
      // Server mode: read user_id from body
      userId = body.userId ?? body?.user_id;
      if (!userId) {
        return new Response(
          JSON.stringify({ error: "user_id required in body for server mode" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }
    } else {
      // Client mode: derive user_id from JWT
      const { data: user, error: userError } = await supabase.auth.getUser(
        token
      );
      userId = user?.user?.id ?? null;
      if (userError || !userId) {
        return new Response(
          JSON.stringify({ error: "Unable to retrieve user" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 401,
          }
        );
      }
    }

    // Validate workspace membership
    const { data: workspace, error: workspaceError } = await supabase
      .from("users_workspaces_map")
      .select("*")
      .eq("user_id", userId)
      .eq("workspace_id", body.workspaceId)
      .single();

    if (workspaceError || !workspace?.workspace_id) {
      return new Response(
        JSON.stringify({ error: "User does not belong to this workspace" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    // Validate required fields
    if (!body.question || typeof body.question !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'question' field" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Get nora-ai backend URL from environment
    // For local testing: use ngrok URL (hardcoded for now)
    // TODO: After deployment, replace with Deno.env.get("NORA_AI_URL")
    const NORA_AI_URL =
      Deno.env.get("NORA_AI_URL") ||
      "https://nora-word-ai-503234474366.europe-west1.run.app";

    console.log(`[nora-chat] Calling nora-ai at: ${NORA_AI_URL}/run`);

    // Call nora-ai backend
    const response = await fetch(`${NORA_AI_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_as_text: body.question,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[nora-chat] nora-ai error: ${response.status} - ${errorText}`
      );
      return new Response(
        JSON.stringify({
          error: "AI backend failed",
          details: errorText,
          status_code: response.status,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error || "AI processing failed",
          details: result.details,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Extract the answer text from the result
    // nora-ai returns: { success: true, result: { output_text: "..." }, type: "..." }
    const answerText =
      result.result?.output_text ||
      (typeof result.result === "string"
        ? result.result
        : JSON.stringify(result.result));

    const finalResult = {
      success: true,
      answer: answerText,
      type: result.type,
      rawResult: result.result,
    };

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[nora-chat] Internal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
