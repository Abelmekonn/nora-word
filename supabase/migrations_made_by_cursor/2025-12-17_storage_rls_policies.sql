-- Storage RLS policies for docs-autofills bucket
-- Created to fix: "new row violates row-level security policy" (403) when uploading files
--
-- NOTE: This only adds Storage policies. Your table RLS policies are already set up.
-- NOTE: Policies run as SECURITY INVOKER (using the executing user's privileges, not the policy creator's).
-- Do NOT apply this on production unless you have verified the target project.

-- Drop existing policies if they exist (to ensure clean recreation with SECURITY INVOKER)
drop policy if exists "storage_docs_autofills_insert_authenticated" on storage.objects;
drop policy if exists "storage_docs_autofills_select_authenticated" on storage.objects;
drop policy if exists "storage_docs_autofills_update_authenticated" on storage.objects;
drop policy if exists "storage_docs_autofills_delete_authenticated" on storage.objects;

-- Create policies (they will run as SECURITY INVOKER by default - using the authenticated user's privileges)
create policy "storage_docs_autofills_insert_authenticated"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'docs-autofills');

create policy "storage_docs_autofills_select_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'docs-autofills');

create policy "storage_docs_autofills_update_authenticated"
on storage.objects
for update
to authenticated
using (bucket_id = 'docs-autofills');

create policy "storage_docs_autofills_delete_authenticated"
on storage.objects
for delete
to authenticated
using (bucket_id = 'docs-autofills');
