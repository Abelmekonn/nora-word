/**
 * Word Document Integration Service
 * Provides methods to interact with Word documents via Office.js API
 */

import mammoth from "mammoth";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";
import { DiffOperation } from "../utils/diffParser";

declare const Word: typeof import("@microsoft/office-js").Word;
declare const Office: typeof import("@microsoft/office-js").Office;

/**
 * Check if we're running inside Word
 */
export function isRunningInWord(): boolean {
  try {
    return (
      typeof Office !== "undefined" &&
      typeof Word !== "undefined" &&
      Office.context?.host === Office.HostType.Word
    );
  } catch {
    return false;
  }
}

/**
 * Get the entire document content as plain text
 */
export async function getDocumentContent(): Promise<string> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, returning empty content");
    return "";
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return body.text;
  });
}

/**
 * Get the currently selected text
 */
export async function getSelectedText(): Promise<string> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, returning empty selection");
    return "";
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    return selection.text;
  });
}

/**
 * Insert text at the current cursor position
 */
export async function insertTextAtCursor(text: string): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot insert text");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(text, Word.InsertLocation.replace);
    await context.sync();
  });
}

/**
 * Insert text at the end of the document
 */
export async function insertTextAtEnd(text: string): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot insert text");
    return;
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    body.insertText(text, Word.InsertLocation.end);
    await context.sync();
  });
}

/**
 * Replace the selected text with new text
 */
export async function replaceSelectedText(newText: string): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot replace text");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(newText, Word.InsertLocation.replace);
    await context.sync();
  });
}

/**
 * Insert a paragraph at the end of the document
 */
export async function insertParagraph(text: string): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot insert paragraph");
    return;
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    body.insertParagraph(text, Word.InsertLocation.end);
    await context.sync();
  });
}

/**
 * Replace document content while attempting to preserve paragraph styles.
 * This works by iterating through existing paragraphs and updating their text content
 * rather than clearing the body and inserting new text.
 *
 * If paragraph-level operations fail (e.g., protected document, tracked changes),
 * it falls back to simple content replacement.
 */
export async function replaceDocumentContentPreservingStyles(
  newContent: string
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot replace document content");
    return;
  }

  try {
    return await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("text");
      await context.sync();

      // Split new content into lines/paragraphs
      // Handle different newline formats and filter out completely empty trailing lines
      const newLines = newContent.split(/\r\n|\r|\n/);

      const existingCount = paragraphs.items.length;
      const newCount = newLines.length;

      // If document is empty or new content is empty, use simple replacement
      if (existingCount === 0 || newCount === 0) {
        const body = context.document.body;
        body.clear();
        if (newContent.trim()) {
          body.insertText(newContent, Word.InsertLocation.start);
        }
        await context.sync();
        return;
      }

      // Update existing paragraphs
      const updateCount = Math.min(existingCount, newCount);

      for (let i = 0; i < updateCount; i++) {
        // Only update if text is different to minimize operations
        // Normalize both strings by trimming trailing special characters Word adds
        const existingText = paragraphs.items[i].text.replace(
          /[\r\n\u000B\u000C\u0085\u2028\u2029]+$/g,
          ""
        );
        const newText = newLines[i];

        if (existingText !== newText) {
          // Use a non-empty placeholder if the target text is empty to avoid GeneralException
          const textToInsert = newText || " ";
          paragraphs.items[i].insertText(
            textToInsert,
            Word.InsertLocation.replace
          );
        }
      }

      // If there are more new lines than existing paragraphs, append them
      if (newCount > existingCount) {
        const body = context.document.body;
        for (let i = existingCount; i < newCount; i++) {
          // Only add non-empty paragraphs
          if (newLines[i].trim() !== "") {
            body.insertParagraph(newLines[i], Word.InsertLocation.end);
          }
        }
      }

      // If there are fewer new lines than existing paragraphs, delete the excess
      // We iterate backwards to avoid index issues when deleting
      // Skip deletion if it would result in an empty document
      if (existingCount > newCount && newCount > 0) {
        for (let i = existingCount - 1; i >= newCount; i--) {
          try {
            paragraphs.items[i].delete();
          } catch (deleteErr) {
            console.warn(
              `[wordService] Could not delete paragraph ${i}:`,
              deleteErr
            );
            // Continue with other deletions
          }
        }
      }

      await context.sync();
    });
  } catch (err) {
    // Fallback: if style-preserving replacement fails, use simple replacement
    console.warn(
      "[wordService] replaceDocumentContentPreservingStyles failed, falling back to simple replacement:",
      err
    );
    return replaceDocumentContent(newContent);
  }
}

/**
 * Search and highlight text in the document
 */
export async function searchAndHighlight(searchText: string): Promise<number> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot search");
    return 0;
  }

  return Word.run(async (context) => {
    const results = context.document.body.search(searchText, {
      matchCase: false,
    });
    results.load("items");
    await context.sync();

    // Highlight each result
    for (let i = 0; i < results.items.length; i++) {
      results.items[i].font.highlightColor = "Yellow";
    }
    await context.sync();

    return results.items.length;
  });
}

/**
 * Search and replace text in the document
 */
export async function searchAndReplace(
  searchText: string,
  replaceText: string
): Promise<number> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot search and replace");
    return 0;
  }

  return Word.run(async (context) => {
    const results = context.document.body.search(searchText, {
      matchCase: false,
      ignorePunct: true,
      ignoreSpace: true,
    });
    results.load("items");
    await context.sync();

    // Replace each result
    // We iterate in reverse order to avoid invalidating ranges if that were an issue,
    // though for simple replacement it might not be strictly necessary with Office.js objects.
    for (let i = results.items.length - 1; i >= 0; i--) {
      results.items[i].insertText(replaceText, Word.InsertLocation.replace);
    }
    await context.sync();

    return results.items.length;
  });
}

/**
 * Search and replace text in the current selection
 */
export async function searchAndReplaceInSelection(
  searchText: string,
  replaceText: string
): Promise<number> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot search and replace in selection");
    return 0;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const results = selection.search(searchText, {
      matchCase: false,
      ignorePunct: true,
      ignoreSpace: true,
    });
    results.load("items");
    await context.sync();

    for (let i = results.items.length - 1; i >= 0; i--) {
      results.items[i].insertText(replaceText, Word.InsertLocation.replace);
    }
    await context.sync();

    return results.items.length;
  });
}

/**
 * Clear all highlighting in the document
 */
export async function clearHighlighting(): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot clear highlighting");
    return;
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    body.font.highlightColor = null;
    await context.sync();
  });
}

/**
 * Get document properties (title, author, etc.)
 */
export async function getDocumentProperties(): Promise<{
  title: string;
  author: string;
  lastModifiedBy: string;
  creationDate: Date | null;
}> {
  if (!isRunningInWord()) {
    return {
      title: "",
      author: "",
      lastModifiedBy: "",
      creationDate: null,
    };
  }

  return Word.run(async (context) => {
    const properties = context.document.properties;
    properties.load(["title", "author", "lastModifiedBy", "creationDate"]);
    await context.sync();

    return {
      title: properties.title || "",
      author: properties.author || "",
      lastModifiedBy: properties.lastModifiedBy || "",
      creationDate: properties.creationDate || null,
    };
  });
}

/**
 * Insert content with track changes style (for redlining)
 * Note: Actual track changes requires specific Office 365 features
 */
export async function insertWithRedline(
  originalText: string,
  newText: string
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot insert redline");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();

    // Insert original text with strikethrough (simulating deletion)
    const deletedRange = selection.insertText(
      originalText,
      Word.InsertLocation.replace
    );
    deletedRange.font.strikeThrough = true;
    deletedRange.font.color = "red";

    // Insert new text with underline (simulating addition)
    const addedRange = deletedRange.insertText(
      " " + newText,
      Word.InsertLocation.after
    );
    addedRange.font.underline = Word.UnderlineType.single;
    addedRange.font.color = "blue";
    addedRange.font.strikeThrough = false;

    await context.sync();
  });
}

/**
 * Get the word count of the document
 */
export async function getWordCount(): Promise<number> {
  if (!isRunningInWord()) {
    return 0;
  }

  const content = await getDocumentContent();
  return content.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Add a comment to the selected text
 */
export async function addComment(commentText: string): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot add comment");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertComment(commentText);
    await context.sync();
  });
}

/**
 * Get the document as a base64-encoded string for upload
 * Note: This functionality may require specific Office 365 subscription features
 */
export async function getDocumentAsBase64(): Promise<string | null> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot get document as file");
    return null;
  }

  return new Promise((resolve) => {
    try {
      Office.context.document.getFileAsync(
        Office.FileType.Compressed,
        { sliceSize: 4194304 }, // 4MB chunks
        async (result) => {
          if (result.status === Office.AsyncResultStatus.Failed) {
            console.error("Failed to get document file:", result.error);
            resolve(null);
            return;
          }

          const file = result.value;
          const sliceCount = file.sliceCount;
          const chunks: string[] = [];

          for (let i = 0; i < sliceCount; i++) {
            const sliceResult = await new Promise<
              Office.AsyncResult<Office.Slice>
            >((resolveSlice) => {
              file.getSliceAsync(i, resolveSlice);
            });

            if (sliceResult.status === Office.AsyncResultStatus.Succeeded) {
              const slice = sliceResult.value;
              // Convert slice data to base64
              const base64Chunk = btoa(
                String.fromCharCode.apply(
                  null,
                  new Uint8Array(
                    slice.data as ArrayBuffer
                  ) as unknown as number[]
                )
              );
              chunks.push(base64Chunk);
            }
          }

          file.closeAsync();
          resolve(chunks.join(""));
        }
      );
    } catch (error) {
      console.error("Error getting document as file:", error);
      resolve(null);
    }
  });
}

/**
 * Replace entire document content with new text
 */
export async function replaceDocumentContent(
  newContent: string
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot replace document content");
    return;
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    body.clear();
    body.insertText(newContent, Word.InsertLocation.start);
    await context.sync();
  });
}

/**
 * Clear the current selection in the document by collapsing it to the end.
 */
export async function clearSelection(): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot clear selection");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    // Collapse the selection to the end to "unselect" the text
    selection.select(Word.SelectionMode.end);
    await context.sync();
  });
}

/**
 * Extract raw text from a .docx ArrayBuffer using Mammoth
 */
export async function parseDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Fill a .docx template (ArrayBuffer) with data using Docxtemplater
 */
export function fillDocxTemplate(
  arrayBuffer: ArrayBuffer,
  data: Record<string, any>
): Blob {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  doc.render(data);

  const out = doc.getZip().generate({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return out;
}

/**
 * Save a Blob as a file
 */
export function saveBlob(blob: Blob, filename: string) {
  saveAs(blob, filename);
}

// ------------------------------------------------------------------
// Senior Developer Implementation: Structural Translation Helpers
// ------------------------------------------------------------------

export interface StructuralSegment {
  id: number;
  text: string;
}

/**
 * Retrieves all paragraphs in the document (including inside tables)
 * to allow for structural translation without destroying formatting.
 */
export async function getParagraphsForTranslation(): Promise<
  StructuralSegment[]
> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, returning empty segments");
    return [];
  }

  return Word.run(async (context) => {
    // getRange().paragraphs gets ALL paragraphs in the document body,
    // strictly in reading order, including those inside tables, headers, etc.
    const paragraphs = context.document.body.getRange().paragraphs;
    paragraphs.load("text");
    await context.sync();

    const segments: StructuralSegment[] = [];
    for (let i = 0; i < paragraphs.items.length; i++) {
      const p = paragraphs.items[i];
      // Only include paragraphs that actually have text to translation
      // We keep the index 'i' to map it back later.
      // We filter out purely empty paragraphs to save tokens?
      // Risk: If we filter, we must use the original index 'i' for restoration.
      const text = p.text.trim();
      if (text.length > 0) {
        segments.push({ id: i, text: p.text });
      }
    }
    return segments;
  });
}

/**
 * Applies translated text back to the specific paragraphs identified by index.
 * Uses in-place replacement to PRESERVE styles, tables, and formatting.
 */
export async function applyTranslationToParagraphs(
  segments: StructuralSegment[]
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot apply translations");
    return;
  }

  return Word.run(async (context) => {
    // We need to fetch the paragraphs again.
    // detailed assumption: The document structure has NOT changed since we read it.
    // This is a standard assumption for synchronous add-in operations.
    const paragraphs = context.document.body.getRange().paragraphs;

    // We don't need to load text, just the object references for interaction
    // But loading a property is good practice to ensure the object exists
    paragraphs.load("items");
    await context.sync();

    // Create a batch of updates
    // Office.js handles batched commands when we call sync() at the end.
    for (const segment of segments) {
      if (segment.id < paragraphs.items.length) {
        const para = paragraphs.items[segment.id];
        // We replace the text content.
        // "InsertLocation.replace" on a paragraph replaces its content
        // but keeps the paragraph object (and its style) alive.
        para.insertText(segment.text, Word.InsertLocation.replace);
      } else {
        console.warn(
          `[wordService] Paragraph index ${segment.id} out of bounds`
        );
      }
    }

    await context.sync();
  });
}

/**
 * Retrieves paragraphs from the current selection for structural translation.
 */
export async function getSelectedParagraphsForTranslation(): Promise<
  StructuralSegment[]
> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, returning empty segments");
    return [];
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs;
    paragraphs.load("text");
    await context.sync();

    const segments: StructuralSegment[] = [];
    for (let i = 0; i < paragraphs.items.length; i++) {
      const p = paragraphs.items[i];
      const text = p.text.trim();
      if (text.length > 0) {
        segments.push({ id: i, text: p.text });
      }
    }
    return segments;
  });
}

/**
 * Applies translated text back to the selected paragraphs.
 */
export async function applyTranslationToSelectedParagraphs(
  segments: StructuralSegment[]
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot apply translations");
    return;
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const segment of segments) {
      if (segment.id < paragraphs.items.length) {
        const para = paragraphs.items[segment.id];
        para.insertText(segment.text, Word.InsertLocation.replace);
      } else {
        console.warn(
          `[wordService] Selected paragraph index ${segment.id} out of bounds`
        );
      }
    }

    await context.sync();
  });
}

/**
 * Applies a granular diff to the text.
 * @param operations The diff operations to apply
 * @param targetScope 'selection' or 'document'. Defaults to 'selection'.
 * @throws Error if no changes were applied (indicating failure to match text), so caller can use fallback.
 */
export async function applyGranularChanges(
  operations: DiffOperation[],
  targetScope: "selection" | "document" = "selection"
): Promise<void> {
  if (!isRunningInWord()) {
    console.warn("Not running in Word, cannot apply diff");
    return;
  }

  return Word.run(async (context) => {
    // 1. Determine Search Scope
    // We use a 'remainingRange' approach where we shrink the search area as we progress.
    // This allows us to find duplicate words correctly (finding the 'next' instance).
    let remainingRange: Word.Range;

    if (targetScope === "document") {
      remainingRange = context.document.body;
    } else {
      remainingRange = context.document.getSelection();
    }

    // We need to keep a reference to the end of the scope to extend our remaining range correctly
    const scopeEnd = remainingRange.getRange(Word.RangeLocation.end);

    // Track successful edits
    let changesApplied = 0;

    // 2. Iterate Operations
    for (const op of operations) {
      if (op.op === "match" && op.text) {
        // MATCH: Skip forward
        // Use ignoreSpace: true to handle spacing differences robustly
        // Use ignorePunct: false ? Punctuation usually matters for structure.
        // MATCH
        // 1. Try Strict Match (Respecting precise whitespace from tokenizer)
        let searchResults = remainingRange.search(op.text, {
          matchCase: true,
          matchWildcards: false,
          ignoreSpace: false,
        });
        searchResults.load("items");

        await context.sync();

        // 2. Fallback: Loose Match
        if (searchResults.items.length === 0) {
          searchResults = remainingRange.search(op.text, {
            matchCase: true,
            matchWildcards: false,
            ignoreSpace: true,
          });
          searchResults.load("items");
          await context.sync();
        }

        if (searchResults.items.length > 0) {
          const matchRange = searchResults.items[0];

          // Advance: New remaining range starts AFTER this match
          // and extends to the end of the original scope.
          remainingRange = matchRange
            .getRange(Word.RangeLocation.after)
            .expandTo(scopeEnd);
        } else {
          console.warn(
            `[applyGranularChanges] Match text not found: "${op.text.substring(
              0,
              20
            )}..." in remaining scope.`
          );
        }
      } else if (op.op === "replace" && op.original && op.modified) {
        // REPLACE: Preference for Strict Match to preserve spacing correctness
        let searchResults = remainingRange.search(op.original, {
          matchCase: true,
          matchWildcards: false,
          ignoreSpace: false,
        });
        searchResults.load("items");
        await context.sync();

        // Fallback for Replace
        if (searchResults.items.length === 0) {
          searchResults = remainingRange.search(op.original, {
            matchCase: true,
            matchWildcards: false,
            ignoreSpace: true,
          });
          searchResults.load("items");
          await context.sync();
        }

        if (searchResults.items.length > 0) {
          const matchItem = searchResults.items[0];

          // Execute Replace
          const newRange = matchItem.insertText(
            op.modified,
            Word.InsertLocation.replace
          );

          // Advance
          remainingRange = newRange
            .getRange(Word.RangeLocation.after)
            .expandTo(scopeEnd);
          changesApplied++;
        } else {
          console.warn(
            `[applyGranularChanges] Replace target not found: "${op.original.substring(
              0,
              20
            )}..."`
          );
        }
      } else if (op.op === "delete" && op.original) {
        // DELETE: Preference for Strict Match
        let searchResults = remainingRange.search(op.original, {
          matchCase: true,
          matchWildcards: false,
          ignoreSpace: false,
        });
        searchResults.load("items");
        await context.sync();

        if (searchResults.items.length === 0) {
          searchResults = remainingRange.search(op.original, {
            matchCase: true,
            matchWildcards: false,
            ignoreSpace: true,
          });
          searchResults.load("items");
          await context.sync();
        }

        if (searchResults.items.length > 0) {
          const matchItem = searchResults.items[0];
          matchItem.delete();
          // Deleted item collapses. Get range after it.
          // Note: In Word JS, if you delete a range, you can usually still get a range "after" it relative to the document flow.
          remainingRange = matchItem
            .getRange(Word.RangeLocation.after)
            .expandTo(scopeEnd);
          changesApplied++;
        } else {
          console.warn(
            `[applyGranularChanges] Delete target not found: "${op.original.substring(
              0,
              20
            )}..."`
          );
        }
      } else if (op.op === "insert" && op.modified) {
        // INSERT
        // Insert at the START of the remaining range
        const newRange = remainingRange.insertText(
          op.modified,
          Word.InsertLocation.start
        );

        // Advance
        remainingRange = newRange
          .getRange(Word.RangeLocation.after)
          .expandTo(scopeEnd);
        changesApplied++;
      }

      // Syncing is handled inside the 'if' blocks for search results.
      // But for 'insert' we need a sync to update remainingRange properly?
      // insertText is queued. 'getRange' might need a sync?
      // Actually 'getRange' works on objects. 'expandTo' works on objects.
      // But 'newRange' comes from a command.
      // It's safer to sync if we changed something.
      if (op.op === "insert") await context.sync();
    }

    // Check if we did anything
    const meaningfulOps = operations.filter((o) => o.op !== "match").length;
    if (meaningfulOps > 0 && changesApplied === 0) {
      throw new Error("No granular changes could be applied (text mismatch).");
    }
  });
}
