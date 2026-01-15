# 🏁 **PHASE 1 — Build & Host Frontend on Vercel**

### **1. Make sure your Office Add-in builds**

If you use Vite:

```
npm run build
```

Result should be:
# Deployment Guide (Production)

This project is a Microsoft Word Office Add-in.

In production you deploy:

1) A hosted HTTPS web app (the taskpane/commands UI)
2) An Office Add-in manifest that points to that hosted web app

This repo already contains environment-specific manifests:

- `manifests/nora-legal.manifest.dev.xml`
- `manifests/nora-legal.manifest.staging.xml`
- `manifests/nora-legal.manifest.prod.xml`

> Recommendation: Always use **staging → production promotion** with distinct manifests and URLs.

---

## 0) Choose a release path

There are two common production paths. You can do both.

### A) Internal (best for companies): Microsoft 365 Admin Center → Integrated Apps

- Your IT/admin uploads the manifest and deploys it to users/groups.
- Fastest path for enterprise rollout.
- No public listing.

### B) Public: AppSource

- Public marketplace listing and Microsoft validation.
- Requires privacy/terms/support pages and stricter validation.

---

## 1) Where to host the frontend

Your add-in UI is a static Vite build, so you can host it on any reliable HTTPS static host.

Recommended hosting options:

- **Azure Static Web Apps** (enterprise-friendly, Microsoft-aligned)
- **Vercel** / **Netlify** (excellent DX, previews, rollbacks)

Production best practice:

- Use a **custom domain** (e.g. `https://addins.yourcompany.com`) instead of a default `*.vercel.app` domain.
- Ensure TLS/HTTPS is enabled (Office add-ins require HTTPS).

---

## 2) Build the add-in web app

Install + build:

```
npm ci
npm run build
```

Build output should contain:

```
dist/
  index.html
  taskpane.html
  commands.html
  assets/
```

Quick manual checks after hosting:

```
https://<YOUR_HOST>/taskpane.html
https://<YOUR_HOST>/commands.html
```

---

## 3) Deploy the frontend (example: Vercel)

In the Vercel UI:

1. Import the GitHub repo
2. Project Settings → Build & Output
   - Framework: **Other**
   - Build command: `npm run build`
   - Output directory: `dist`
3. Add environment variables for the target environment (staging or prod)
4. Deploy

After deployment you’ll get an HTTPS URL (use custom domain for production).

---

## 4) Configure the manifest (use the repo manifests)

Pick the manifest to update:

- Staging: `manifests/nora-legal.manifest.staging.xml`
- Production: `manifests/nora-legal.manifest.prod.xml`

Update all URLs to point to your hosted domain.

Typical items:

- Taskpane `SourceLocation` → `https://<YOUR_HOST>/taskpane.html`
- Commands URL → `https://<YOUR_HOST>/commands.html`
- Icon URLs → `https://<YOUR_HOST>/assets/icon-32.png` etc.

Example:

```xml
<SourceLocation DefaultValue="https://<YOUR_HOST>/taskpane.html"/>
<Url id="Commands.Url" DefaultValue="https://<YOUR_HOST>/commands.html"/>
<IconUrl DefaultValue="https://<YOUR_HOST>/assets/icon-32.png"/>
<HighResolutionIconUrl DefaultValue="https://<YOUR_HOST>/assets/icon-80.png"/>
```

### Allowed/Trusted domains (manifest)

Office add-ins often require specifying which domains the add-in is allowed to navigate to.

Add your production host domain and any required backend/auth domains (examples):

- `https://<YOUR_HOST>`
- Your Supabase project domain (if used)
- Your auth provider domains (if used)

> This is a common source of “works in dev, fails in validation” issues.

---

## 5) Test the manifest in Word (sideload)

Always test the **staging** manifest first, then the **production** manifest.

### Windows Word

1. Copy the manifest file to:

   ```
   %LOCALAPPDATA%\Microsoft\Office\16.0\WEF\
   ```

2. Open Word → Insert → My Add-ins → Shared Folder
3. Load the add-in

### Mac Word

1. Copy the manifest file to:

   ```
   ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
   ```

2. Restart Word

### Word on the web

1. Go to https://office.com
2. Open Word → Insert → Add-ins → Upload My Add-in
3. Choose the manifest file

Smoke test checklist:

- Taskpane loads
- Commands work
- Login flow works end-to-end
- Backend calls succeed
- No console errors

---

## 6) Backend + CORS (important correction)

For most add-ins, your frontend runs at `https://<YOUR_HOST>` and **that** is what calls your backend.

So your backend CORS should allow:

- `https://<YOUR_HOST>` (production)
- `https://<YOUR_STAGING_HOST>` (staging)

Avoid overly broad wildcards like `*.microsoft.com` unless you have a specific, reviewed reason.

---

## 7) Internal rollout (recommended): Integrated Apps

Use this if your add-in is for a company/organization.

1. Microsoft 365 Admin Center
2. Integrated Apps
3. Upload custom apps
4. Upload the **production** manifest file
5. Assign users/groups

Release process:

- Deploy new frontend build
- Update manifest URLs only if they changed
- Roll out update via Integrated Apps

---

## 8) AppSource submission (public)

Submit in Partner Center:

https://partner.microsoft.com/dashboard

You will need:

- Production manifest
- Public documentation site
- Privacy policy URL
- Terms of use URL
- Support URL / email
- Screenshots (Word UI)
- Accessible UI (keyboard + screen reader)

Common rejection reasons:

- Login breaks inside taskpane
- Missing privacy/terms/support links
- HTTPS issues
- Manifest domain allowlist missing/incomplete
- Broken external links

Validation timing is commonly 5–20 business days.

---

## 9) Production deliverables checklist

```
[ ] Staging host deployed and verified in Word
[ ] Production host deployed (prefer custom domain)
[ ] manifests/nora-legal.manifest.staging.xml points to staging URLs
[ ] manifests/nora-legal.manifest.prod.xml points to production URLs
[ ] Manifest trusted domains updated (host + backend + auth)
[ ] Backend CORS allows only required origins (host domains)
[ ] Works in Word Desktop + Word on the web
[ ] Privacy/Terms/Support pages ready (if AppSource)
[ ] Partner Center submission (if AppSource)
[ ] Internal rollout via Integrated Apps (if enterprise)
```
---
