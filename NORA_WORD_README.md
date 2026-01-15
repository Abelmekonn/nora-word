# Nora Word - AI-Powered Legal Assistant for Microsoft Word

## 🎯 What is Nora Word?

**Nora Word** is an AI-powered assistant that runs as a **Microsoft Word Add-in**. It helps **legal professionals and notaries** work faster by bringing AI capabilities directly into their Word documents.

---

## 📦 Technology Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Backend** | Supabase (Postgres, Auth, Edge Functions) |
| **AI Processing** | GPT-4o / GPT-4o-mini via Cloud Run worker |
| **Office Integration** | Microsoft Office.js API |
| **i18n** | Multi-language support (EN, FR, NL) |

---

## 👤 User Journey

```
User opens Word → Clicks "Open Nora" in ribbon → Task pane opens → Login → Start working
```

---

## 🔑 Core Features

### 1. 💬 AI Chat Assistant (Main Feature)

**What it does:** Users can chat with "Nora" to get help drafting legal content.

| Capability | Description |
|------------|-------------|
| **Draft Content** | Ask Nora to write legal clauses, affidavits, certificates |
| **Context-Aware** | Nora sees the entire document and can reference it |
| **Insert to Document** | One-click to insert AI response into Word |
| **Copy Response** | Copy AI text to clipboard |

**Example User Flow:**
1. User types: "Draft a notarization certificate for a real estate deed"
2. Nora generates the text
3. User clicks "Insert" → Text appears in Word document

---

### 2. ⚡ Quick Actions (Skills Menu)

Four one-click AI operations:

| Action | What It Does | User Flow |
|--------|--------------|-----------|
| **🌐 Translate** | Translate entire document to 20+ languages | Select language → Click "Translate" → Document updated |
| **📝 Fill Template** | Auto-fill placeholders using reference documents | Select reference doc → Click "Fill" → Placeholders replaced |
| **🔒 Anonymize** | Redact sensitive information (names, dates, addresses) | Configure options → Preview → Apply |
| **✨ Improve Writing** | Polish selected text while preserving legal meaning | Select text → Click "Improve" → Review diff → Apply |

---

### 3. 📋 Playbooks (Compliance Checking)

**What it does:** Automatically analyzes documents against predefined rules and suggests corrections.

| Playbook | Purpose | Rules Checked |
|----------|---------|---------------|
| **Notary Compliance** | Ensures notarization requirements | Venue, Jurat, Signature matching, Notary expiration |
| **Real Estate Closing** | Validates property transfer docs | Property address, Grantor/Grantee names, Legal description |

**User Flow:**
1. Open document in Word
2. Select a playbook
3. Click "Run Analysis"
4. Review AI suggestions with severity levels (high/medium/low)
5. Accept or dismiss each suggestion

---

### 4. 📂 History

**What it does:** Stores all previous chat conversations so users can:
- Review past AI interactions
- Continue previous conversations
- Track what actions were performed

---

### 5. 🔍 Document Selection Features

When user **highlights text** in the document:

```
┌────────────────────────────────────┐
│  "15 words highlighted"            │
│  [✨ Improve writing] [X] [▼]      │
└────────────────────────────────────┘
```

- **Improve Writing** - AI polishes the selected text
- Shows word count of selection
- Can dismiss the highlight bar

---

## 🔧 Feature Deep Dives

### Anonymization Feature

**Categories that can be redacted:**
- 👤 Names (people, companies)
- 📍 Addresses
- 📅 Dates
- 💰 Monetary amounts
- 🔢 Numbers
- ✏️ Custom terms (user-defined)

**Process:**
1. Select categories to detect
2. Add any custom terms
3. Click "Preview" → See what will be redacted
4. Click "Apply" → Document updated

**Output Example:**
```
Before: "John Smith signed on January 15, 2024 for $50,000"
After:  "[NAME] signed on [DATE] for [AMOUNT]"
```

---

### Fill Template Feature

**What it solves:** Legal documents often have placeholders like `[CLIENT NAME]` or `{{DATE}}`. This feature auto-fills them using a reference document.

**Supported placeholder formats:**
- `[PLACEHOLDER]`
- `{{PLACEHOLDER}}`

**Process:**
1. Open template document in Word
2. Select reference document (from Knowledge Base or upload)
3. Click "Fill in Template"
4. AI extracts info from reference → Fills placeholders
5. Shows list of changes made

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Microsoft Word                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Task Pane (Add-in)                  │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │    │
│  │  │Assistant│ │ Actions │ │Playbooks│ │History │ │    │
│  │  │  View   │ │  View   │ │  View   │ │ View   │ │    │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │    │
│  │       │           │           │          │       │    │
│  │       └───────────┴───────────┴──────────┘       │    │
│  │                       │                           │    │
│  │              ┌────────┴────────┐                 │    │
│  │              │   AI Services    │                │    │
│  │              │ (Cloud Run GPT)  │                │    │
│  │              └────────┬─────────┘                │    │
│  └───────────────────────┼──────────────────────────┘    │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Supabase   │
                    │ (Auth + DB) │
                    └─────────────┘
```

---

## 🗂️ Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │────▶│  Nora UI    │────▶│  Supabase   │
│  (Word)     │     │ (React App) │     │  (Backend)  │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Word API   │     │  Cloud Run  │
                    │ (Office.js) │     │  (GPT-4o)   │
                    └─────────────┘     └─────────────┘
```

---

## 🔐 Authentication & Security

| Aspect | Implementation |
|--------|----------------|
| **Login** | Email/password via Supabase Auth |
| **Session** | JWT tokens |
| **Multi-tenant** | Workspace-based permissions |
| **API Security** | All AI calls go through authenticated Edge Functions |

---

## 🌍 Localization

The system supports **3 languages**:
- 🇺🇸 English
- 🇫🇷 French
- 🇳🇱 Dutch

User can switch language from the login screen.

---

## 📱 UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Header** | Top | New Chat button, History button |
| **Main View** | Center | Content area (changes based on selected tab) |
| **Chat Input** | Bottom (Assistant only) | Text input with voice support |
| **Bottom Nav** | Bottom | Navigate: Assistant, Actions, Agents, History |

---

## 📁 Project Structure

```
nora-word/
├── components/          # Reusable UI components
│   ├── AgentManager.tsx
│   ├── BottomNav.tsx
│   ├── Button.tsx
│   ├── ChatInput.tsx
│   ├── DocumentEditor.tsx
│   ├── ErrorBoundary.tsx
│   ├── Header.tsx
│   └── Sidebar.tsx
├── views/               # Main view pages
│   ├── ActionsView.tsx
│   ├── AssistantView.tsx
│   ├── DraftingView.tsx
│   ├── HistoryView.tsx
│   ├── LoginView.tsx
│   └── PlaybookView.tsx
├── services/            # Business logic & API calls
│   ├── aiService.ts         # AI operations (draft, translate, etc.)
│   ├── wordService.ts       # Word document integration
│   ├── gptWorkerService.ts  # GPT worker queue
│   ├── anonymizeService.ts  # Anonymization logic
│   ├── dataService.ts       # Data persistence
│   ├── knowledgeService.ts  # Knowledge base
│   ├── uploadService.ts     # File uploads
│   └── supabaseClient.ts    # Supabase client
├── context/             # React context providers
│   ├── AuthContext.tsx
│   └── LanguageContext.tsx
├── locales/             # Translation files
│   ├── en.json
│   ├── fr.json
│   └── nl.json
├── utils/               # Utility functions
├── types.ts             # TypeScript interfaces
├── constants.ts         # App constants & mock data
├── App.tsx              # Main React component
├── manifest.xml         # Office Add-in manifest
└── package.json         # Dependencies
```

---

## 📁 Key Files Reference

| Feature | Files to Review |
|---------|-----------------|
| Main App | `App.tsx` |
| AI Logic | `services/aiService.ts` |
| Word Integration | `services/wordService.ts` |
| Views | `views/*.tsx` |
| Types/Models | `types.ts` |
| Translations | `locales/*.json` |
| Office Manifest | `manifest.xml` |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Microsoft Word (Desktop or Web)

### Installation

```bash
# Navigate to the project
cd nora-word

# Install dependencies
npm install

# Set environment variables
# Create .env file with:
# VITE_SUPABASE_URL=your_supabase_url
# VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Run development server
npm run dev

# Sideload into Word for testing
npm run sideload

# Validate manifest
npm run validate
```

---

## 🎯 Summary

> **Nora Word is a Microsoft Word Add-in that helps legal professionals:**
> 
> 1. **Chat with AI** to draft legal content
> 2. **Translate** documents to other languages
> 3. **Fill templates** automatically from reference docs
> 4. **Anonymize** sensitive information
> 5. **Improve writing** while preserving legal meaning
> 6. **Check compliance** against legal playbooks
> 
> All without leaving Microsoft Word.

---

## 📞 Support

For issues or questions, contact the development team or refer to the technical documentation in the repository.



