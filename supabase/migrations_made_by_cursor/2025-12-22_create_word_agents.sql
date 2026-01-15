-- 0) Required extension for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1) Create table
create table if not exists word_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  created_by uuid not null,
  name text not null,
  description text,
  rules text[],
  system_prompt text,
  model text,
  tools jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_dt timestamptz
);

-- Optional index helpful for RLS checks
create index if not exists idx_word_agents_workspace on word_agents(workspace_id);
create index if not exists idx_word_agents_created_by on word_agents(created_by);

-- 2) Enable Row Level Security
alter table word_agents enable row level security;

-- 4) RLS Policies: Workspace members can SELECT/INSERT/UPDATE/DELETE
-- Fixed: Changed workspace_members to users_workspaces_map
create policy "word_agents_select_workspace_members"
on word_agents
for select
to authenticated
using (
  exists (
    select 1
    from users_workspaces_map wm
    where wm.workspace_id = word_agents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "word_agents_insert_workspace_members"
on word_agents
for insert
to authenticated
with check (
  exists (
    select 1
    from users_workspaces_map wm
    where wm.workspace_id = word_agents.workspace_id
      and wm.user_id = (select auth.uid())
  )
  and created_by = (select auth.uid())
);

create policy "word_agents_update_workspace_members"
on word_agents
for update
to authenticated
using (
  exists (
    select 1
    from users_workspaces_map wm
    where wm.workspace_id = word_agents.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from users_workspaces_map wm
    where wm.workspace_id = word_agents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "word_agents_delete_workspace_members"
on word_agents
for delete
to authenticated
using (
  exists (
    select 1
    from users_workspaces_map wm
    where wm.workspace_id = word_agents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

-- 5) Grants
grant select, insert, update, delete on word_agents to authenticated;

-- 6) Maintain updated_at automatically
-- Note: set_updated_at() function already exists in the database, so this will work
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_word_agents_updated_at on word_agents;
create trigger trg_word_agents_updated_at
before update on word_agents
for each row
execute function set_updated_at();