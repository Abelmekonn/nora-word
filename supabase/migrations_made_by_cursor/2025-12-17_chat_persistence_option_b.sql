-- Nora Word: Chat persistence (Option B: sessions + messages) + required RLS
--
-- IMPORTANT
-- - Do NOT run this on production (project-ref = abbyxyhcglvlsxshqdmx).
-- - Run in your dev/staging project SQL editor.
--
-- This script is a consolidation of:
-- - 2025-12-17_word_chat_sessions_and_messages.sql
-- - 2025-12-17_word_chat_sessions_and_messages_rls_patch.sql
-- - 2025-12-17_word_history_rls_personal_workspace_patch.sql
--
-- It creates the chat tables and applies RLS policies that allow access when:
-- - user belongs to workspace via users_workspaces_map OR
-- - workspace_id = auth.uid() (personal workspace fallback)

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) Chat sessions
-- -----------------------------------------------------------------------------
create table if not exists public.word_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  created_by uuid not null references auth.users(id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  deleted_dt timestamptz
);

create index if not exists word_chat_sessions_workspace_last_message_idx
  on public.word_chat_sessions (workspace_id, last_message_at desc nulls last);

-- -----------------------------------------------------------------------------
-- 2) Chat messages
-- -----------------------------------------------------------------------------
create table if not exists public.word_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.word_chat_sessions(id) on delete cascade,
  workspace_id uuid not null,
  created_by uuid not null references auth.users(id),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_dt timestamptz
);

create index if not exists word_chat_messages_session_created_at_idx
  on public.word_chat_messages (session_id, created_at asc);

create index if not exists word_chat_messages_workspace_created_at_idx
  on public.word_chat_messages (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3) RLS for chat tables
-- -----------------------------------------------------------------------------
alter table public.word_chat_sessions enable row level security;
alter table public.word_chat_messages enable row level security;

-- Reset policies (safe for reruns)
drop policy if exists "chat_sessions_select_in_workspace" on public.word_chat_sessions;
drop policy if exists "chat_sessions_insert_in_workspace" on public.word_chat_sessions;
drop policy if exists "chat_sessions_update_in_workspace" on public.word_chat_sessions;

drop policy if exists "chat_messages_select_in_workspace" on public.word_chat_messages;
drop policy if exists "chat_messages_insert_in_workspace" on public.word_chat_messages;
drop policy if exists "chat_messages_update_in_workspace" on public.word_chat_messages;

-- Sessions: SELECT
create policy "chat_sessions_select_in_workspace"
on public.word_chat_sessions
for select
using (
  deleted_dt is null
  and (
    word_chat_sessions.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_sessions.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
);

-- Sessions: INSERT
create policy "chat_sessions_insert_in_workspace"
on public.word_chat_sessions
for insert
with check (
  created_by = auth.uid()
  and (
    word_chat_sessions.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_sessions.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
);

-- Sessions: UPDATE (includes soft-delete via deleted_dt)
create policy "chat_sessions_update_in_workspace"
on public.word_chat_sessions
for update
using (
  (
    word_chat_sessions.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_sessions.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
)
with check (
  (
    word_chat_sessions.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_sessions.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
);

-- Messages: SELECT
create policy "chat_messages_select_in_workspace"
on public.word_chat_messages
for select
using (
  deleted_dt is null
  and (
    word_chat_messages.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_messages.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
);

-- Messages: INSERT
create policy "chat_messages_insert_in_workspace"
on public.word_chat_messages
for insert
with check (
  created_by = auth.uid()
  and (
    word_chat_messages.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_messages.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
  and exists (
    select 1
    from public.word_chat_sessions s
    where s.id = word_chat_messages.session_id
      and s.workspace_id = word_chat_messages.workspace_id
      and s.deleted_dt is null
  )
);

-- Messages: UPDATE (includes soft-delete via deleted_dt)
create policy "chat_messages_update_in_workspace"
on public.word_chat_messages
for update
using (
  created_by = auth.uid()
  and (
    word_chat_messages.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_messages.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
)
with check (
  created_by = auth.uid()
  and (
    word_chat_messages.workspace_id = auth.uid()
    or exists (
      select 1
      from public.users_workspaces_map uwm
      where uwm.workspace_id = word_chat_messages.workspace_id
        and uwm.user_id = auth.uid()
    )
  )
  and exists (
    select 1
    from public.word_chat_sessions s
    where s.id = word_chat_messages.session_id
      and s.workspace_id = word_chat_messages.workspace_id
      and s.deleted_dt is null
  )
);

-- NOTE: No DELETE policies by design (we soft-delete via deleted_dt).

-- -----------------------------------------------------------------------------
-- 4) RLS patch for word-history (personal workspace fallback)
-- -----------------------------------------------------------------------------
-- We do NOT drop existing policies here; we only add permissive policies for the
-- personal workspace fallback used in the app when workspace membership is missing.

alter table public."word-history" enable row level security;

create policy if not exists "word_history_select_personal_workspace"
on public."word-history"
for select
using (
  deleted_dt is null
  and workspace_id = auth.uid()
  and user_id = auth.uid()
);

create policy if not exists "word_history_insert_personal_workspace"
on public."word-history"
for insert
with check (
  workspace_id = auth.uid()
  and user_id = auth.uid()
);

create policy if not exists "word_history_update_personal_workspace"
on public."word-history"
for update
using (
  workspace_id = auth.uid()
  and user_id = auth.uid()
)
with check (
  workspace_id = auth.uid()
  and user_id = auth.uid()
);
