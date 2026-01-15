import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body first
    const body = await req.json();
    const { action, workspaceId, agentId, agentData } = body;

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    console.log("Auth header present:", !!authHeader);

    if (!authHeader) {
      console.error("No Authorization header found");
      return new Response(JSON.stringify({ error: "User not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    console.log("Token extracted, length:", token.length);

    // Initialize Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user
    const { data: user, error: userError } = await supabase.auth.getUser(token);
    const userId = user?.user?.id;

    console.log("User auth result:", {
      hasUser: !!user?.user,
      userId: userId,
      error: userError?.message,
    });

    if (userError || !userId) {
      console.error("User authentication failed:", userError);
      return new Response(
        JSON.stringify({ error: "Unable to retrieve user" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate workspace membership (for actions that require workspaceId)
    // Allow personal workspace (workspaceId === userId) without membership check
    if (workspaceId) {
      // Personal workspace: if workspaceId equals userId, allow access without membership check
      if (workspaceId === userId) {
        console.log("Personal workspace detected, skipping membership check");
      } else {
        // Shared workspace: require membership in users_workspaces_map
        const { data: workspace, error: workspaceError } = await supabase
          .from("users_workspaces_map")
          .select("*")
          .eq("user_id", userId)
          .eq("workspace_id", workspaceId)
          .single();

        if (workspaceError || !workspace?.workspace_id) {
          console.error("Workspace membership check failed:", workspaceError);
          return new Response(
            JSON.stringify({
              error: "The user does not belong to the workspace",
            }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    // Route based on action
    switch (action) {
      case "create": {
        if (!workspaceId || !agentData) {
          return new Response(
            JSON.stringify({ error: "workspaceId and agentData are required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        const { name, description, rules, system_prompt, model, tools } =
          agentData;

        if (!name) {
          return new Response(JSON.stringify({ error: "name is required" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }

        const { data: newAgent, error: createError } = await supabase
          .from("word_agents")
          .insert([
            {
              workspace_id: workspaceId,
              created_by: userId,
              name,
              description: description || null,
              rules: rules || null,
              system_prompt: system_prompt || null,
              model: model || null,
              tools: tools || null,
            },
          ])
          .select()
          .single();

        if (createError) {
          console.error("Error creating word agent:", createError);
          return new Response(
            JSON.stringify({
              error: "Failed to create word agent",
              details: createError.message,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(JSON.stringify({ success: true, data: newAgent }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      case "update": {
        if (!agentId || !agentData) {
          return new Response(
            JSON.stringify({ error: "agentId and agentData are required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        // First, verify the agent exists and user has access
        const { data: existingAgent, error: fetchError } = await supabase
          .from("word_agents")
          .select("workspace_id, deleted_dt")
          .eq("id", agentId)
          .single();

        if (fetchError || !existingAgent) {
          return new Response(
            JSON.stringify({ error: "Word agent not found" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 404,
            }
          );
        }

        if (existingAgent.deleted_dt) {
          return new Response(
            JSON.stringify({ error: "Word agent is deleted" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        // Verify workspace membership for the agent's workspace
        // Allow personal workspace (workspace_id === userId) without membership check
        if (existingAgent.workspace_id !== userId) {
          // Shared workspace: require membership in users_workspaces_map
          const { data: workspaceCheck } = await supabase
            .from("users_workspaces_map")
            .select("workspace_id")
            .eq("user_id", userId)
            .eq("workspace_id", existingAgent.workspace_id)
            .single();

          if (!workspaceCheck) {
            return new Response(
              JSON.stringify({
                error: "The user does not belong to the workspace",
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 401,
              }
            );
          }
        }

        // Build update object (only include provided fields)
        const updateData: any = {};
        if (agentData.name !== undefined) updateData.name = agentData.name;
        if (agentData.description !== undefined)
          updateData.description = agentData.description;
        if (agentData.rules !== undefined) updateData.rules = agentData.rules;
        if (agentData.system_prompt !== undefined)
          updateData.system_prompt = agentData.system_prompt;
        if (agentData.model !== undefined) updateData.model = agentData.model;
        if (agentData.tools !== undefined) updateData.tools = agentData.tools;

        const { data: updatedAgent, error: updateError } = await supabase
          .from("word_agents")
          .update(updateData)
          .eq("id", agentId)
          .select()
          .single();

        if (updateError) {
          console.error("Error updating word agent:", updateError);
          return new Response(
            JSON.stringify({
              error: "Failed to update word agent",
              details: updateError.message,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: updatedAgent }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      case "delete": {
        if (!agentId) {
          return new Response(
            JSON.stringify({ error: "agentId is required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        // Verify the agent exists and user has access
        const { data: existingAgent, error: fetchError } = await supabase
          .from("word_agents")
          .select("workspace_id, deleted_dt")
          .eq("id", agentId)
          .single();

        if (fetchError || !existingAgent) {
          return new Response(
            JSON.stringify({ error: "Word agent not found" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 404,
            }
          );
        }

        if (existingAgent.deleted_dt) {
          return new Response(
            JSON.stringify({ error: "Word agent is already deleted" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        // Verify workspace membership for the agent's workspace
        // Allow personal workspace (workspace_id === userId) without membership check
        if (existingAgent.workspace_id !== userId) {
          // Shared workspace: require membership in users_workspaces_map
          const { data: workspaceCheck } = await supabase
            .from("users_workspaces_map")
            .select("workspace_id")
            .eq("user_id", userId)
            .eq("workspace_id", existingAgent.workspace_id)
            .single();

          if (!workspaceCheck) {
            return new Response(
              JSON.stringify({
                error: "The user does not belong to the workspace",
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 401,
              }
            );
          }
        }

        // Soft delete
        const { data: deletedAgent, error: deleteError } = await supabase
          .from("word_agents")
          .update({ deleted_dt: new Date().toISOString() })
          .eq("id", agentId)
          .select()
          .single();

        if (deleteError) {
          console.error("Error deleting word agent:", deleteError);
          return new Response(
            JSON.stringify({
              error: "Failed to delete word agent",
              details: deleteError.message,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: deletedAgent }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      case "get": {
        if (!agentId) {
          return new Response(
            JSON.stringify({ error: "agentId is required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        const { data: agent, error: fetchError } = await supabase
          .from("word_agents")
          .select("*")
          .eq("id", agentId)
          .is("deleted_dt", null)
          .single();

        if (fetchError || !agent) {
          return new Response(
            JSON.stringify({ error: "Word agent not found" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 404,
            }
          );
        }

        // Verify workspace membership for the agent's workspace
        // Allow personal workspace (workspace_id === userId) without membership check
        if (agent.workspace_id !== userId) {
          // Shared workspace: require membership in users_workspaces_map
          const { data: workspaceCheck } = await supabase
            .from("users_workspaces_map")
            .select("workspace_id")
            .eq("user_id", userId)
            .eq("workspace_id", agent.workspace_id)
            .single();

          if (!workspaceCheck) {
            return new Response(
              JSON.stringify({
                error: "The user does not belong to the workspace",
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 401,
              }
            );
          }
        }

        return new Response(JSON.stringify({ success: true, data: agent }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      case "list": {
        if (!workspaceId) {
          return new Response(
            JSON.stringify({ error: "workspaceId is required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        const { data: agents, error: listError } = await supabase
          .from("word_agents")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_dt", null)
          .order("created_at", { ascending: false });

        if (listError) {
          console.error("Error listing word agents:", listError);
          return new Response(
            JSON.stringify({
              error: "Failed to list word agents",
              details: listError.message,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: agents || [] }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: "Invalid action",
            validActions: ["create", "update", "delete", "get", "list"],
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
    }
  } catch (err) {
    console.error("Internal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
