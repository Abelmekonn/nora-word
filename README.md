<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1KeRb2MwvYvLt0lfTAIC4nAY7AXkCRjW5

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`

2. **(First time only) Install development certificates:**
   Required for Office Add-ins to run on localhost.
   `npx office-addin-dev-certs install`

3. Configure environment:
   - Required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Optional (defaults provided): `VITE_GCP_WORKER_ROOT_URL`, `VITE_LLM_LARGE_INPUT_THRESHOLD`, `VITE_LLM_WORKER_CHUNK_SIZE`

4. Run the app:
   `npm run dev`

5. **Sideload into Word:**
   - **Option A (Desktop):** Run `npm run sideload` (starts Word automatically).
   - **Option B (Web):** Go to Word Online -> Insert -> Add-ins -> Upload My Add-in -> Select `manifests/nora-legal.manifest.dev.xml`.

## AI calls routing

- All AI requests are routed through the Cloud Run generic worker (`/supabase_generic_gpt_calls/`) using the Supabase session JWT for authentication.
- Requests are enqueued into `public.word_ai_tasks` and processed by the worker, which allows sending the full document text and avoids Edge Function context/timeout limits.

## Cursor rules

This project includes Cursor workspace rules under `.cursor/rules/` to guide architecture, Supabase usage, and editor conventions. These rules are copied from our `ai-toolbox` project and will be applied automatically by Cursor when working in this repository.
