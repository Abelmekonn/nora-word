-- Fix: Add personal workspace support to word_agents RLS policies
-- This allows users to access their own workspace (workspace_id = auth.uid()) 
-- without requiring a record in users_workspaces_map

-- Update SELECT policy to allow personal workspace
DROP POLICY IF EXISTS "word_agents_select_workspace_members" ON word_agents;
CREATE POLICY "word_agents_select_workspace_members"
ON word_agents
FOR SELECT
TO authenticated
USING (
  -- Personal workspace: allow if workspace_id = auth.uid()
  word_agents.workspace_id = auth.uid()
  OR
  -- Shared workspace: require membership in users_workspaces_map
  EXISTS (
    SELECT 1
    FROM users_workspaces_map wm
    WHERE wm.workspace_id = word_agents.workspace_id
      AND wm.user_id = auth.uid()
  )
);

-- Update INSERT policy to allow personal workspace
DROP POLICY IF EXISTS "word_agents_insert_workspace_members" ON word_agents;
CREATE POLICY "word_agents_insert_workspace_members"
ON word_agents
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    -- Personal workspace: allow if workspace_id = auth.uid()
    word_agents.workspace_id = auth.uid()
    OR
    -- Shared workspace: require membership in users_workspaces_map
    EXISTS (
      SELECT 1
      FROM users_workspaces_map wm
      WHERE wm.workspace_id = word_agents.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
);

-- Update UPDATE policy to allow personal workspace
DROP POLICY IF EXISTS "word_agents_update_workspace_members" ON word_agents;
CREATE POLICY "word_agents_update_workspace_members"
ON word_agents
FOR UPDATE
TO authenticated
USING (
  -- Personal workspace: allow if workspace_id = auth.uid()
  word_agents.workspace_id = auth.uid()
  OR
  -- Shared workspace: require membership in users_workspaces_map
  EXISTS (
    SELECT 1
    FROM users_workspaces_map wm
    WHERE wm.workspace_id = word_agents.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  -- Personal workspace: allow if workspace_id = auth.uid()
  word_agents.workspace_id = auth.uid()
  OR
  -- Shared workspace: require membership in users_workspaces_map
  EXISTS (
    SELECT 1
    FROM users_workspaces_map wm
    WHERE wm.workspace_id = word_agents.workspace_id
      AND wm.user_id = auth.uid()
  )
);

-- Update DELETE policy to allow personal workspace
DROP POLICY IF EXISTS "word_agents_delete_workspace_members" ON word_agents;
CREATE POLICY "word_agents_delete_workspace_members"
ON word_agents
FOR DELETE
TO authenticated
USING (
  -- Personal workspace: allow if workspace_id = auth.uid()
  word_agents.workspace_id = auth.uid()
  OR
  -- Shared workspace: require membership in users_workspaces_map
  EXISTS (
    SELECT 1
    FROM users_workspaces_map wm
    WHERE wm.workspace_id = word_agents.workspace_id
      AND wm.user_id = auth.uid()
  )
);
