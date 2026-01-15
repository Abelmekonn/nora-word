# Translation Formatting & Structure Preservation Plan - Senior Implementation

## 1. Problem Diagnosis: The "Full-Document" Anti-Pattern

The current implementation utilizes a **full-document text replacement strategy** (`Word document → extract full text → AI → replace document`).

- **Severity**: Critical / Anti-pattern.
- **Impact**: Word is a structured object model, not a simple text area. Replacing the body text destroys the XML structure, resulting in the loss of:
  - **Tables** (flattened to text)
  - **Styles** (headers, fonts, spacing reset)
  - **Immutable Data** (links, email addresses, fields broken)

## 2. Core Principles for the Fix

### Principle A: Structural Traversal (DOM-like Approach)

We must treat the Word document like a DOM. We will iterate through specific nodes (Paragraphs, Table Cells) and replace **only the text content** within those nodes. This preserves the container's properties (borders, background, style class).

### Principle B: Tokenization (Preserving Immutables)

AI translation often corrupts non-translatable entities. We must implement a "Tokenize → Translate → Detokenize" pipeline.

- **Pattern**: `Email` → `__EMAIL_0__`.
- **Strategy**: Identify emails, URLs, and specific named entities _before_ sending to AI, and restore them _after_ receiving the translation.

### Principle C: Cell-by-Cell Table Handling

Tables cannot be stringified. They must be traversed hierarchically: `Table → Row → Cell`. Each cell is treated as an isolated translation unit to preserve grid structure.

## 3. Detailed Architecture Flow

### Step 1: Mapping & Tokenization (`wordService.ts`)

Instead of `body.text`, we implement `mapDocumentContent()`:

1.  **Iterate** through `body.paragraphs` and `body.tables`.
2.  **Extract** text from Paragraphs.
3.  **Extract** text from Table Cells (nested iteration).
4.  **Tokenize** each text segment:
    - Regex match emails, URLs, and specific placeholders.
    - Store matches in a separate `tokens` map.
    - Replace in text with `__TOKEN_X__`.

### Step 2: Context-Aware AI Request (`aiService.ts`)

We send a **structured JSON payload** to the AI, not raw text.

- **Payload**: `{ "segments": ["Segment 1 text...", "Segment 2 text..."] }`
- **Prompt Constraints**:
  - "Return JSON only."
  - "Do not merge or split segments."
  - "Do not translate tokens beginning with \_\_."
  - "Maintain exact array length and order."

### Step 3: Reconstruction & In-Place Update (`wordService.ts`)

Upon receiving the AI response:

1.  **Detokenize**: Replace `__TOKEN_X__` with the original values (restoring the link/email).
2.  **Iterate & Update**:
    - Match the translated segment index to the original Word Object ID.
    - Call `object.insertText(translatedText, Word.InsertLocation.replace)` for that specific Paragraph or Cell.

## 4. Implementation Checklist

### Phase 1: Service Layer Updates

- [ ] **`wordService.ts`**: Implement `getStructuralSegments()` to return an array of objects `{ id, type: 'paragraph'|'cell', text }`.
- [ ] **`wordService.ts`**: Implement `updateStructuralSegments(updates)` which takes `{ id, newText }` and applies it.
- [ ] **`aiService.ts`**: Implement `tokenize(text)` and `detokenize(text, tokens)`.

### Phase 2: AI Orchestration

- [ ] **`aiService.ts`**: Update `translateDocument` to handle array-based inputs/outputs.
- [ ] **Prompt Engineering**: Enforce strict JSON array output to ensure 1:1 mapping between limitations.

### Phase 3: Frontend Integration

- [ ] **`ActionsView.tsx`**: Update the translation handler to use the new `translationPipeline` instead of the raw text replacement.

## 5. Why This Works (Industry Standard)

This approach mirrors architectures used by enterprise legal AI tools (like Harvey/Legora):

- **Styles Preserved**: Because we only swap the _content_ of a paragraph, the _container_ (which holds the formatting) is untouched.
- **Data Integrity**: Tokenization guarantees that sensitive or functional text (URLs, Refs) survives the LLM round-trip.
- **Scalability**: Structured segments allow for partial processing or progress tracking in the future.
