# Nora Legal Word Add-in — Enterprise IT Installation Guide (M365 Admin)

This guide is for customer IT admins who deploy the Nora Legal Word add-in centrally so it appears automatically in Microsoft Word for assigned users.

## What you are deploying

- **Type**: Microsoft Office Word add-in (Office Web Add-in)
- **UI hosting**: Nora Legal is a web app hosted by Nora (HTTPS)
- **Installation method**: Microsoft 365 Admin Center → Centralized Deployment
- **Updates**: UI updates are delivered from the hosted URL; no end-user reinstall

## Prerequisites

- Microsoft 365 tenant admin access
- Microsoft Word (Desktop and/or Word on the Web)
- Ability to allow outbound HTTPS to the domains listed in **Network allowlist** below

## Install (Centralized Deployment)

1. Open **Microsoft 365 Admin Center**
2. Navigate to **Settings → Integrated apps**
3. Select **Upload custom apps**
4. Upload the manifest file provided by Nora:
   - Production: `nora-legal.manifest.prod.xml`
   - Staging (optional, for pilots): `nora-legal.manifest.staging.xml`
5. When prompted, assign users:
   - **Entire organization**, or
   - **Specific security groups** (recommended for pilots)
6. Finish the deployment.

## Verify (Desktop Word)

1. On a user machine in the assigned scope, open **Microsoft Word**
2. Locate the add-in (Ribbon → Add-ins / Home tab group depending on tenant policy)
3. Click **Nora Legal** / **Open Nora**
4. A task pane opens on the right.

## Verify (Word on the Web)

1. Open Word on the Web
2. Open any document
3. Launch **Nora Legal** from add-ins

Note: availability of specific ribbon commands can vary by platform. The task pane is the primary UX.

## Network allowlist (Outbound HTTPS)

Customer environments often require explicit allowlisting. Provide these domains to IT/security teams.

Replace placeholders with the values in your manifest(s):

- Nora UI host (task pane + commands):
  - `https://<YOUR_NORA_HOSTNAME>`
- Microsoft Office runtime (required):
  - `https://appsforoffice.microsoft.com`
- Supabase project (auth + API):
  - `https://<YOUR_SUPABASE_PROJECT>.supabase.co`
- AI worker / processing endpoint(s) (if used):
  - `https://<YOUR_AI_WORKER_HOSTNAME>`

## Data handling summary (enterprise-facing)

- The add-in runs in Microsoft Office’s add-in sandbox.
- Document content is accessed via Office.js APIs.
- Any upload/processing of document content is intended to be **user-triggered** (not automatic background upload).
- Authentication is handled by Supabase Auth.

If your firm requires a deeper security review (data retention, logging, DPA, sub-processors), ask Nora for the security package.

## Updates & change control

- **UI updates**: deployed by Nora to the hosted web app URL; users receive updates automatically.
- **Manifest changes** (e.g., new permissions, new domains, new command surface): require IT to upload the new manifest.

## Troubleshooting

- **Add-in does not appear**: confirm the user is in the assigned scope; allow time for propagation.
- **Task pane opens but UI is blank**: check outbound HTTPS allowlist and SSL inspection/proxy policies.
- **Login fails**: ensure access to the Supabase domain is allowed.
