import { supabase } from './supabaseClient';

type WaitOpts = { timeoutMs: number; intervalMs: number };

export function chunkText(text: string, chunkSize: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}

async function getAuthAndContext() {
  const [{ data: sessionRes }, { data: userRes }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser()
  ]);
  const session = sessionRes?.session;
  const user = userRes?.user;
  if (!session || !user) {
    throw new Error('User not authenticated');
  }

  // Try to resolve workspace from profiles.current_workspace_id; fallback to user.id
  const { data: prof } = await supabase
    .from('profiles')
    .select('current_workspace_id, email, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const workspaceId = prof?.current_workspace_id || user.id;
  const userEmail = prof?.email || user.email || '';

  return { session, user, userEmail, workspaceId };
}

export async function enqueueAndStart(
  inputChunks: string[],
  gptPrompt: string,
  meta: Record<string, any> = {}
): Promise<string> {
  const { session, user, userEmail, workspaceId } = await getAuthAndContext();

  // 1) Insert task row
  const { data: inserted, error: insertErr } = await supabase
    .from('word_ai_tasks')
    .insert({
      workspace_id: workspaceId,
      created_by: user.id,
      status: 'pending',
      gpt_prompt: gptPrompt,
      input_chunks: inputChunks,
      meta
    })
    .select('id')
    .single();
  if (insertErr || !inserted?.id) {
    throw new Error(insertErr?.message || 'Failed to enqueue task');
  }
  const taskId: string = inserted.id;

  // 2) Call generic worker (Cloud Run)
  const rootUrl =
    (import.meta as any).env?.VITE_GCP_WORKER_ROOT_URL ||
    'https://ai-assistant-prod-jybetmkkea-ew.a.run.app';
  const apiUrl = `${rootUrl}/supabase_generic_gpt_calls/`;

  const body = {
    client_id: workspaceId,
    user_id: user.id,
    user_email: userEmail,
    table_name: 'public.word_ai_tasks',
    row_ids: [taskId],
    bubble_env: 'supabase-live',
    row_to_process: 'input_chunks',
    row_to_update: 'output_chunks',
    gpt_prompt: gptPrompt,
    content_chunk_placeholder: '<content_chunk>',
    gpt_output_format: 'json',
    join_method: 'table',
    status_row: 'status',
    done_status: 'done',
    processing_status: 'processing',
    error_status: 'error',
    error_message_column: 'error_message'
  };

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const details = await resp.text().catch(() => '');
    throw new Error(`Generic worker failed (${resp.status}): ${details}`);
  }
  const json = await resp.json().catch(() => ({}));
  if (!json?.success) {
    throw new Error('Generic worker response indicates failure');
  }

  return taskId;
}

export async function getTask(taskId: string) {
  const { data, error } = await supabase
    .from('word_ai_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function waitForCompletion(taskId: string, opts: WaitOpts) {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    const row = await getTask(taskId);
    if (!row) {
      throw new Error('Task not found');
    }
    if (row.status === 'done') {
      return row;
    }
    if (row.status === 'error') {
      throw new Error(row.error_message || 'Generic worker error');
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error('Timed out waiting for worker completion');
}


