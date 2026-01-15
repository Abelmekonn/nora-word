/**
 * useWordDocument Hook
 *
 * React hook that provides real-time access to the Word document content
 * and selection when running as a Microsoft Word Add-in.
 *
 * This replaces the custom DocumentEditor approach by directly communicating
 * with the active Word document via Office.js API.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  isRunningInWord,
  getDocumentContent,
  getSelectedText,
  insertTextAtCursor,
  insertTextAtEnd,
  replaceSelectedText,
  replaceDocumentContent,
  replaceDocumentContentPreservingStyles,
  searchAndReplace as searchAndReplaceService,
  searchAndReplaceInSelection as searchAndReplaceInSelectionService,
  clearSelection as clearSelectionService,
} from "../services/wordService";

interface UseWordDocumentResult {
  /** Current document content (plain text) */
  documentContent: string;
  /** Currently selected text in Word */
  selection: string;
  /** Whether we're running inside Word */
  isInWord: boolean;
  /** Whether the document content is currently loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh document content from Word */
  refreshContent: () => Promise<void>;
  /** Refresh selection from Word */
  refreshSelection: () => Promise<void>;
  /** Insert text at cursor position in Word */
  insertAtCursor: (text: string) => Promise<void>;
  /** Insert text at end of Word document */
  insertAtEnd: (text: string) => Promise<void>;
  /** Replace selected text in Word */
  replaceSelection: (newText: string) => Promise<void>;
  /** Replace entire document content in Word */
  replaceDocument: (newContent: string) => Promise<void>;
  /** Replace entire document content in Word while preserving paragraph styles */
  replaceDocumentPreservingStyles: (newContent: string) => Promise<void>;
  /** Search and replace text in the document */
  searchAndReplace: (
    searchText: string,
    replaceText: string
  ) => Promise<number>;
  /** Search and replace text in the selection */
  searchAndReplaceInSelection: (
    searchText: string,
    replaceText: string
  ) => Promise<number>;
  /** Clear current selection state (UI and Word) */
  clearSelection: () => void;
}

export function useWordDocument(): UseWordDocumentResult {
  const [documentContent, setDocumentContent] = useState<string>("");
  const [selection, setSelection] = useState<string>("");
  const [isInWord, setIsInWord] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [officeReady, setOfficeReady] = useState<boolean>(false);

  // Interval ref for polling
  const pollingIntervalRef = useRef<number | null>(null);

  // Check if running in Word on mount.
  // IMPORTANT: Office.context is not guaranteed to be populated until Office.onReady() resolves.
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const office = (globalThis as any).Office;

      // If Office.js isn't present, we're definitely not inside Word.
      if (!office || typeof office.onReady !== "function") {
        if (cancelled) return;
        setOfficeReady(false);
        setIsInWord(false);
        setIsLoading(false);
        setError(
          "Not running inside Microsoft Word. Please open this add-in from Word."
        );
        return;
      }

      try {
        setIsLoading(true);
        const info = await office.onReady();
        if (cancelled) return;

        setOfficeReady(true);

        // Prefer the host value returned by onReady, fall back to context.
        const host = info?.host ?? office.context?.host;
        const inWord = host === office.HostType?.Word;

        setIsInWord(inWord);
        setError(
          inWord
            ? null
            : "Not running inside Microsoft Word. Please open this add-in from Word."
        );
      } catch (e) {
        console.error("[useWordDocument] Office initialization failed:", e);
        if (cancelled) return;
        setOfficeReady(false);
        setIsInWord(false);
        setIsLoading(false);
        setError(
          "Failed to initialize Office. Please restart Word and try again."
        );
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch document content
  const refreshContent = useCallback(async () => {
    if (!officeReady || !isInWord || !isRunningInWord()) {
      return;
    }

    try {
      const content = await getDocumentContent();
      setDocumentContent(content);
      setError(null);
    } catch (e) {
      console.error("[useWordDocument] Failed to get document content:", e);
      setError("Failed to read document content");
    }
  }, []);

  // Fetch selection
  const refreshSelection = useCallback(async () => {
    if (!officeReady || !isInWord || !isRunningInWord()) {
      return;
    }

    try {
      const selected = await getSelectedText();
      setSelection(selected);
    } catch (e) {
      console.error("[useWordDocument] Failed to get selection:", e);
    }
  }, []);

  // Initial load + polling for content/selection changes
  useEffect(() => {
    if (!officeReady) return;
    if (!isInWord || !isRunningInWord()) {
      setIsLoading(false);
      return;
    }

    const loadInitial = async () => {
      setIsLoading(true);
      try {
        await Promise.all([refreshContent(), refreshSelection()]);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitial();

    // Poll for selection changes (Word doesn't have a selection change event in all platforms)
    // Poll every 500ms for selection, every 2s for content
    let selectionPollCount = 0;
    pollingIntervalRef.current = window.setInterval(() => {
      refreshSelection();
      selectionPollCount++;
      // Refresh content less frequently (every 2 seconds)
      if (selectionPollCount % 4 === 0) {
        refreshContent();
      }
    }, 500);

    return () => {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [officeReady, isInWord, refreshContent, refreshSelection]);

  // Insert at cursor
  const insertAtCursor = useCallback(
    async (text: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        console.warn("[useWordDocument] Not in Word, cannot insert at cursor");
        return;
      }

      try {
        await insertTextAtCursor(text);
        // Refresh content after insertion
        await refreshContent();
      } catch (e) {
        console.error("[useWordDocument] Failed to insert at cursor:", e);
        setError("Failed to insert text");
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Insert at end
  const insertAtEnd = useCallback(
    async (text: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        console.warn("[useWordDocument] Not in Word, cannot insert at end");
        return;
      }

      try {
        await insertTextAtEnd(text);
        await refreshContent();
      } catch (e) {
        console.error("[useWordDocument] Failed to insert at end:", e);
        setError("Failed to insert text at end");
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Replace selection
  const replaceSelection = useCallback(
    async (newText: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        console.warn("[useWordDocument] Not in Word, cannot replace selection");
        return;
      }

      try {
        await replaceSelectedText(newText);
        await refreshContent();
        setSelection(""); // Clear selection after replace
      } catch (e) {
        console.error("[useWordDocument] Failed to replace selection:", e);
        setError("Failed to replace selected text");
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Replace entire document
  const replaceDocument = useCallback(
    async (newContent: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        console.warn("[useWordDocument] Not in Word, cannot replace document");
        return;
      }

      try {
        await replaceDocumentContent(newContent);
        await refreshContent();
      } catch (e) {
        console.error("[useWordDocument] Failed to replace document:", e);
        setError("Failed to replace document content");
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Replace entire document preserving styles
  const replaceDocumentPreservingStyles = useCallback(
    async (newContent: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        console.warn("[useWordDocument] Not in Word, cannot replace document");
        return;
      }

      try {
        await replaceDocumentContentPreservingStyles(newContent);
        await refreshContent();
      } catch (e) {
        console.error(
          "[useWordDocument] Failed to replace document preserving styles:",
          e
        );
        setError("Failed to replace document content");
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Clear selection (UI and Word)
  const clearSelection = useCallback(async () => {
    setSelection("");
    if (officeReady && isInWord && isRunningInWord()) {
      try {
        await clearSelectionService();
      } catch (e) {
        console.error(
          "[useWordDocument] Failed to clear selection in Word:",
          e
        );
      }
    }
  }, [officeReady, isInWord]);

  // Search and replace in document
  const searchAndReplace = useCallback(
    async (searchText: string, replaceText: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        return 0;
      }
      try {
        const count = await searchAndReplaceService(searchText, replaceText);
        await refreshContent();
        return count;
      } catch (e) {
        console.error("[useWordDocument] Failed to search and replace:", e);
        return 0;
      }
    },
    [officeReady, isInWord, refreshContent]
  );

  // Search and replace in selection
  const searchAndReplaceInSelection = useCallback(
    async (searchText: string, replaceText: string) => {
      if (!officeReady || !isInWord || !isRunningInWord()) {
        return 0;
      }
      try {
        const count = await searchAndReplaceInSelectionService(
          searchText,
          replaceText
        );
        await refreshContent();
        await refreshSelection();
        return count;
      } catch (e) {
        console.error(
          "[useWordDocument] Failed to search and replace in selection:",
          e
        );
        return 0;
      }
    },
    [officeReady, isInWord, refreshContent, refreshSelection]
  );

  return {
    documentContent,
    selection,
    isInWord,
    isLoading,
    error,
    refreshContent,
    refreshSelection,
    insertAtCursor,
    insertAtEnd,
    replaceSelection,
    replaceDocument,
    replaceDocumentPreservingStyles,
    searchAndReplace,
    searchAndReplaceInSelection,
    clearSelection,
  };
}
