
import React, { useState, useEffect, useRef } from 'react';
import { improveWriting, translateDocument, translateDocumentStructurally, fillTemplateWithSummary, TemplateChangeItem, getTemplateData } from '../services/aiService';
import { fillDocxTemplate, parseDocxText, getParagraphsForTranslation, applyTranslationToParagraphs, applyGranularChanges } from '../services/wordService';
import { parseDiffMarkup, computeWordDiff } from '../utils/diffParser';
import {
  previewAnonymization,
  anonymizeText,
  localAnonymize,
  localAnonymizeWithReplacements,
  AnonymizeOptions,
  AnonymizePreviewResult,
  DEFAULT_ANONYMIZE_OPTIONS
} from '../services/anonymizeService';
import { fetchReferenceDocs, ReferenceDoc, addToHistory, createChatSession, saveChatMessage } from '../services/dataService';
import { FileEdit, Languages, PenLine, RefreshCw, ChevronLeft, ChevronUp, ChevronDown, Search, Plus, X, Check, Play, UserX, FileText, Eye, AlertCircle, Loader2 } from 'lucide-react';
import { MOCK_REFERENCE_DOCS } from '../constants';
import { fetchKnowledgeDocs, fetchKnowledgeDocContent, KnowledgeDoc } from '../services/knowledgeService';
import { uploadFilesToKnowledge, getAcceptForSmartDrafting } from '../services/uploadService';
import { useLanguage } from '../context/LanguageContext';
import { ImprovementResult } from '../types';

interface ActionsViewProps {
  documentContent: string;
  selection: string;
  onUpdateDocument: (newContent: string) => void | Promise<void>;
  onUpdateDocumentPreservingStyles?: (newContent: string) => void | Promise<void>;
  onUpdateSelection: (newSelection: string) => void | Promise<void>;
  onSearchAndReplace: (searchText: string, replaceText: string) => Promise<number>;
  onSearchAndReplaceInSelection: (searchText: string, replaceText: string) => Promise<number>;
  /** Optional: if provided, immediately open this action view instead of showing the list */
  initialAction?: 'ANONYMIZE' | 'TRANSLATE' | null;
  originalDocBuffer: ArrayBuffer | null;
  onUpdateOriginalDocBuffer: (buffer: ArrayBuffer) => void;
}

export const ActionsView: React.FC<ActionsViewProps> = ({
  documentContent,
  selection,
  onUpdateDocument,
  onUpdateDocumentPreservingStyles,
  onUpdateSelection,
  onSearchAndReplace,
  onSearchAndReplaceInSelection,
  initialAction,
  originalDocBuffer,
  onUpdateOriginalDocBuffer
}) => {
  const { t } = useLanguage();

  const LANGUAGES = [
    { name: String(t('translationLanguages.arabic')), code: 'sa' },
    { name: String(t('translationLanguages.bulgarian')), code: 'bg' },
    { name: String(t('translationLanguages.chinese')), code: 'cn' },
    { name: String(t('translationLanguages.chineseSimplified')), code: 'cn' },
    { name: String(t('translationLanguages.chineseTraditional')), code: 'tw' },
    { name: String(t('translationLanguages.czech')), code: 'cz' },
    { name: String(t('translationLanguages.danish')), code: 'dk' },
    { name: String(t('translationLanguages.dutch')), code: 'nl' },
    { name: String(t('translationLanguages.englishAmerican')), code: 'us' },
    { name: String(t('translationLanguages.englishBritish')), code: 'gb' },
    { name: String(t('translationLanguages.estonian')), code: 'ee' },
    { name: String(t('translationLanguages.finnish')), code: 'fi' },
    { name: String(t('translationLanguages.french')), code: 'fr' },
    { name: String(t('translationLanguages.german')), code: 'de' },
    { name: String(t('translationLanguages.greek')), code: 'gr' },
    { name: String(t('translationLanguages.hungarian')), code: 'hu' },
    { name: String(t('translationLanguages.indonesian')), code: 'id' },
    { name: String(t('translationLanguages.italian')), code: 'it' },
    { name: String(t('translationLanguages.japanese')), code: 'jp' },
    { name: String(t('translationLanguages.korean')), code: 'kr' },
    { name: String(t('translationLanguages.latvian')), code: 'lv' },
    { name: String(t('translationLanguages.lithuanian')), code: 'lt' },
  ];

  const [viewState, setViewState] = useState<'LIST' | 'ANONYMIZE' | 'ANONYMIZE_PREVIEW' | 'TRANSLATE' | 'FIELD_TEMPLATE' | 'FIELD_TEMPLATE_RESULT' | 'IMPROVE_PREVIEW' | 'IMPROVE_OPTIONS'>('LIST');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Loading state specifically for fetching Reference/Knowledge docs in FIELD_TEMPLATE.
  // Kept separate from `loading` which is used by action executions (fill/anonymize/translate/etc.).
  const [docsLoading, setDocsLoading] = useState(false);

  // Reference Docs
  const [referenceDocs, setReferenceDocs] = useState<ReferenceDoc[]>([]);
  const [selectedReferenceDocId, setSelectedReferenceDocId] = useState<string | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [knowledgeDocsError, setKnowledgeDocsError] = useState<string | null>(null);
  const [selectedKnowledgeDocId, setSelectedKnowledgeDocId] = useState<string | null>(null);
  const [attachmentSearch, setAttachmentSearch] = useState('');
  // Result state for FIELD_TEMPLATE (explicit per user request: render change list like screenshot)
  const [templateChanges, setTemplateChanges] = useState<TemplateChangeItem[]>([]);
  const [lastRefDocName, setLastRefDocName] = useState<string | null>(null);
  // Expand/collapse state for template result items - tracks which items are expanded
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  // Upload status banner for "Add documents" in FIELD_TEMPLATE.
  // Explicitly requested by the user: show clear feedback whether upload is running/succeeded/failed.
  const [uploadStatus, setUploadStatus] = useState<{
    state: 'idle' | 'validating' | 'uploading' | 'done' | 'error';
    message?: string;
  }>({ state: 'idle' });

  // Translate State
  const [selectedLanguage, setSelectedLanguage] = useState(String(t('actionsView.defaultLanguage')));
  const [languageSearch, setLanguageSearch] = useState('');

  // Anonymize state - use the imported type and defaults
  const [anonymizeOptions, setAnonymizeOptions] = useState<AnonymizeOptions>(DEFAULT_ANONYMIZE_OPTIONS);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [newCustomTerm, setNewCustomTerm] = useState('');
  const [previewResult, setPreviewResult] = useState<AnonymizePreviewResult | null>(null);
  const [anonymizeError, setAnonymizeError] = useState<string | null>(null);
  const [useLocalFallback, setUseLocalFallback] = useState(false);

  // Improve writing state - stores result to show preview before applying
  const [improvementResult, setImprovementResult] = useState<ImprovementResult | null>(null);
  const [improveTarget, setImproveTarget] = useState<'SELECTION' | 'DOCUMENT' | null>(null);

  // Error state for displaying user-friendly error messages (replaces window.alert which is not supported in Office.js)
  // Explicit user request: Replace alert() calls with UI-based error display
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hidden file input ref used for "Add documents" in FIELD_TEMPLATE
  // Explicit request by user: Make the "Add documents" button functional.
  // Reasoning: We expose a hidden file input to leverage native file picker restrictions
  // (accept attribute) based on central config in services/uploadService/config/documentTypes.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const matchesAttachmentSearch = (name: string | null | undefined) => {
    const query = attachmentSearch.trim();
    if (!query) return true;
    if (!name) return false;

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        // Remove diacritics for more forgiving search (e.g., é -> e)
        .replace(/[\u0300-\u036f]/g, '');

    const haystack = normalize(name);
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    return tokens.every((tok) => haystack.includes(tok));
  };

  // Handle initialAction prop to immediately open the specified action view
  // This allows navigation from AssistantView dropdown to go directly to Anonymize/Translate
  useEffect(() => {
    if (initialAction === 'ANONYMIZE') {
      setViewState('ANONYMIZE');
    } else if (initialAction === 'TRANSLATE') {
      setViewState('TRANSLATE');
    }
  }, [initialAction]);

  useEffect(() => {
    if (viewState === 'FIELD_TEMPLATE') {
      const loadDocs = async () => {
        setDocsLoading(true);
        try {
          // Try DB first, fall back to constants for the specific video demo files
          const refDocs = await fetchReferenceDocs();
          if (refDocs.length > 0) {
            setReferenceDocs(refDocs);
          } else {
            // Transform MOCK_REFERENCE_DOCS to match ReferenceDoc interface
            setReferenceDocs(MOCK_REFERENCE_DOCS.map(d => ({
              id: d.id,
              name: d.name,
              type: d.type,
              content: d.content,
              doc_date: d.date,
              created_at: new Date().toISOString()
            } as ReferenceDoc)));
          }

          // Load Knowledge docs (ready + processing)
          const { docs: kdocs, error } = await fetchKnowledgeDocs({ statusList: ['ready', 'processing'] });
          setKnowledgeDocs(kdocs);
          setKnowledgeDocsError(error);
        } catch (e) {
          // Keep error surfaced via existing UI (knowledgeDocsError banner); avoid blocking the view.
          setKnowledgeDocsError(e instanceof Error ? e.message : String(e));
        } finally {
          setDocsLoading(false);
        }
      };
      loadDocs();
    }
  }, [viewState]);

  // Auto-dismiss upload success toast after 15 seconds
  useEffect(() => {
    if (uploadStatus.state === 'done') {
      const timer = setTimeout(() => {
        setUploadStatus({ state: 'idle' });
      }, 7000); // 7 seconds
      return () => clearTimeout(timer);
    }
  }, [uploadStatus.state]);

  // Poll for document status updates when there are documents in "processing" status
  // This ensures the UI reflects when documents finish processing without requiring navigation
  useEffect(() => {
    // Only poll when on FIELD_TEMPLATE view and there are processing documents
    const hasProcessingDocs = knowledgeDocs.some(
      doc => (doc.status || '').toLowerCase() === 'processing'
    );

    if (viewState !== 'FIELD_TEMPLATE' || !hasProcessingDocs) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const { docs: kdocs, error } = await fetchKnowledgeDocs({ statusList: ['ready', 'processing'] });
        if (!error) {
          setKnowledgeDocs(kdocs);
        }
      } catch (e) {
        // Silently ignore polling errors to avoid spamming the user
        console.warn('Polling error:', e);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [viewState, knowledgeDocs]);

  /**
   * handleAddDocumentsClick
   * Explicit request by user: Trigger file selection when clicking "Add documents".
   * Reasoning: Keeps UI clean; hidden input honors allowed extensions via accept attribute.
   */
  const handleAddDocumentsClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * handleFilesSelected
   * Explicit request by user: Upload selected files to Knowledge and launch indexing.
   * Reasoning: Uses uploadFilesToKnowledge which validates against central config
   * and triggers the indexing Edge Function as per workspace rules.
   */
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      setUploadStatus({ state: 'validating', message: String(t('actions.fillTemplateView.uploadValidating')) });
      // Let React paint the banner before starting network work (UX clarity).
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setUploadStatus({ state: 'uploading', message: String(t('actions.fillTemplateView.uploadUploading')).replace('{0}', String(files.length)) });
      const { uploaded, indexingLaunched, errors } = await uploadFilesToKnowledge(files, 'SMART_DRAFTING');
      if (uploaded.length > 0) {
        // Build success message for UI display (replaces alert() which is not supported in Office.js)
        const processingText = indexingLaunched ? ` ${String(t('actionsView.uploadSuccessWithIndexing'))}` : '';
        const successMessage = `${uploaded.length} ${String(t('actions.fillTemplateView.uploadDocumentAdded'))}${processingText}`;
        setUploadStatus({ state: 'done', message: successMessage });

        // Refresh Knowledge docs list to show the newly uploaded document
        const { docs: kdocs, error } = await fetchKnowledgeDocs({ statusList: ['ready', 'processing'] });
        setKnowledgeDocs(kdocs);
        if (error) {
          setKnowledgeDocsError(error);
          // If refetch failed, show a warning but keep the success message
          setUploadStatus({ state: 'done', message: String(t('actions.fillTemplateView.uploadListRefreshFailed')) });
        }
      }
      if (errors.length > 0) {
        // Surface the first error prominently
        setUploadStatus({ state: 'error', message: errors[0] });
      }
    } catch (err) {
      setUploadStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Reset input value so the same file(s) can be selected again if needed
      if (e.target) e.target.value = '';
    }
  };

  // Render Diff Markup for improvement preview
  // Parses <remove>...</remove> and <add>...</add> tags to show changes visually
  const renderDiff = (markup: string) => {
    const parts = markup.split(/(<remove>.*?<\/remove>|<add>.*?<\/add>)/g);
    return parts.map((part, i) => {
      if (part.startsWith('<remove>')) {
        return (
          <span key={i} className="line-through decoration-red-400 decoration-2 text-red-800/60 bg-red-50/80 px-1 rounded mx-0.5">
            {part.replace(/<\/?remove>/g, '')}
          </span>
        );
      }
      if (part.startsWith('<add>')) {
        return (
          <span key={i} className="text-green-800 bg-green-100/80 px-1 rounded mx-0.5 font-medium">
            {part.replace(/<\/?add>/g, '')}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // Preview anonymization first
  const handleAnonymizePreview = async () => {
    setPreviewLoading(true);
    setAnonymizeError(null);

    const contentToAnonymize = selection || documentContent;

    try {
      // Try Supabase Edge function first
      const result = await previewAnonymization(contentToAnonymize, anonymizeOptions, customTerms);

      if (result.success) {
        setPreviewResult(result);
        setUseLocalFallback(false);
        setViewState('ANONYMIZE_PREVIEW');
      } else {
        // Fall back to local anonymization
        console.warn('Supabase anonymization failed, using local fallback:', result.error);
        const localResult = localAnonymize(contentToAnonymize, anonymizeOptions, customTerms);
        setPreviewResult({
          success: true,
          anonymizedText: localResult,
          detectedTerms: customTerms,
          originalTerms: [],
        });
        setUseLocalFallback(true);
        setAnonymizeError(String(t('actionsView.errorUsingLocalAnonymization')));
        setViewState('ANONYMIZE_PREVIEW');
      }
    } catch (e) {
      console.error('Anonymization preview error:', e);
      // Fall back to local anonymization
      const localResult = localAnonymize(contentToAnonymize, anonymizeOptions, customTerms);
      setPreviewResult({
        success: true,
        anonymizedText: localResult,
        detectedTerms: customTerms,
        originalTerms: [],
      });
      setUseLocalFallback(true);
      setAnonymizeError('Using local anonymization (server unavailable)');
      setViewState('ANONYMIZE_PREVIEW');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Apply anonymization after preview confirmation
  // Uses the already-computed preview result instead of making another API call
  const handleAnonymizeRun = async () => {
    setLoading(true);
    setAnonymizeError(null);

    try {
      let replacements = previewResult?.replacements || [];
      let anonymizedText = previewResult?.anonymizedText;

      // If no preview result or using local fallback, generate replacements locally
      if ((!replacements || replacements.length === 0) && useLocalFallback) {
        const contentToAnonymize = selection || documentContent;
        const localResult = localAnonymizeWithReplacements(
          contentToAnonymize,
          anonymizeOptions,
          customTerms
        );
        replacements = localResult.replacements;
        anonymizedText = localResult.anonymizedText;
      }

      // CRITICAL FIX: If we still have no granular replacements but have the anonymized text,
      // compute the diff to generate replacements. This prevents replacing the entire document/selection
      // and destroying formatting (tables, styles, images etc).
      if ((!replacements || replacements.length === 0) && anonymizedText) {
        const contentToAnonymize = selection || documentContent;
        // Only attempt diff if the text is different
        if (contentToAnonymize !== anonymizedText) {
          try {
            const diffs = computeWordDiff(contentToAnonymize, anonymizedText);
            if (diffs.length > 0) {
              console.log("Computed granular anonymization changes via diff:", diffs.length);
              replacements = diffs.map(d => ({
                term: d.original,
                category: 'DIFF',
                replacementText: d.modified // Custom property to bypass category lookup
              })) as any;
            }
          } catch (e) {
            console.warn("Failed to compute diff for anonymization fallback:", e);
          }
        }
      }

      // If we have replacements, use search and replace to preserve formatting
      if (replacements && replacements.length > 0) {
        const CATEGORY_PLACEHOLDERS: Record<string, string> = {
          addresses: '[ADDRESS]',
          company_names: '[COMPANY]',
          dates: '[DATE]',
          names: '[PERSON]',
          emails: '[EMAIL]',
          urls: '[WEBSITE]',
          // Fallbacks for local anonymization or other variations
          address: '[ADDRESS]',
          company: '[COMPANY]',
          date: '[DATE]',
          personName: '[PERSON]',
          location: '[LOCATION]',
          email: '[EMAIL]',
          website: '[WEBSITE]',
          // Custom
          CUSTOM: '[REDACTED]',
        };

        for (const item of replacements) {
          // Use explicit replacement text if available (from diff fallback), otherwise look up category
          const placeholder = (item as any).replacementText ||
            CATEGORY_PLACEHOLDERS[item.category] ||
            `[${item.category.toUpperCase()}]`;

          if (selection) {
            await onSearchAndReplaceInSelection(item.term, placeholder);
          } else {
            await onSearchAndReplace(item.term, placeholder);
          }
        }
      } else {
        // Fallback to replacing the entire text (legacy behavior)
        let result: string;

        if (anonymizedText) {
          result = anonymizedText;
        } else {
          // Should not happen, but fallback to original content
          result = selection || documentContent;
        }

        if (selection) {
          onUpdateSelection(result);
        } else {
          onUpdateDocument(result);
        }
      }

      // Log to history in background (don't block UI)
      // Option 1: Do NOT save actions to history.

      // Immediately update UI
      setLoading(false);
      setViewState('LIST');
      setPreviewResult(null);
      setCustomTerms([]);
    } catch (e) {
      console.error('Anonymization error:', e);
      setAnonymizeError(e instanceof Error ? e.message : 'Error anonymizing text');
      setLoading(false);
    }
  };

  // Add a custom term to the anonymization list
  const handleAddCustomTerm = () => {
    if (newCustomTerm.trim() && !customTerms.includes(newCustomTerm.trim())) {
      setCustomTerms(prev => [...prev, newCustomTerm.trim()]);
      setNewCustomTerm('');
    }
  };

  // Remove a custom term
  const handleRemoveCustomTerm = (term: string) => {
    setCustomTerms(prev => prev.filter(t => t !== term));
  };

  const handleImprove = () => {
    setViewState('IMPROVE_OPTIONS');
  };

  const handleImproveSelection = async () => {
    if (!selection) {
      setErrorMessage("Please select text in the document first to improve it.");
      return;
    }
    setLoading(true);
    setImproveTarget('SELECTION');
    setErrorMessage(null); // Clear any previous errors
    try {
      const result = await improveWriting(selection);
      // Show preview instead of immediately applying - user can review and choose to apply or dismiss
      setImprovementResult(result);
      setViewState('IMPROVE_PREVIEW');
    } catch (e) {
      setErrorMessage("Error improving text: " + (e instanceof Error ? e.message : String(e)));
      alert(String(t('actionsView.errorImprovingText')));
    } finally {
      setLoading(false);
    }
  };

  const handleImproveDocument = async () => {
    setLoading(true);
    setImproveTarget('DOCUMENT');
    try {
      const result = await improveWriting(documentContent);
      // Show preview instead of immediately applying - user can review and choose to apply or dismiss
      setImprovementResult(result);
      setViewState('IMPROVE_PREVIEW');
    } catch (e) {
      alert(String(t('actionsView.errorImprovingText')));
    } finally {
      setLoading(false);
    }
  };

  // Apply the improved text and return to list
  const handleApplyImprovement = async () => {
    if (improvementResult) {
      // Strategy: Use AI's diffMarkup to extract only the specific word changes.
      // Then, perform simple search-and-replace for each changed word.
      // This avoids touching whitespace/formatting and is much more robust.

      let applied = false;

      if (improvementResult.diffMarkup) {
        try {
          // Extract replacement pairs from diffMarkup
          const replacements: Array<{ original: string, modified: string }> = [];

          // Pattern: <remove>X</remove><add>Y</add> -> Replace X with Y
          const replacePattern = /<remove>(.*?)<\/remove>\s*<add>(.*?)<\/add>/gs;
          let match;
          while ((match = replacePattern.exec(improvementResult.diffMarkup)) !== null) {
            const original = match[1].trim();
            const modified = match[2].trim();
            if (original && modified) {
              replacements.push({ original, modified });
            }
          }

          // Perform each replacement using Word's native search-and-replace
          if (replacements.length > 0) {
            for (const { original, modified } of replacements) {
              if (improveTarget === 'SELECTION') {
                await onSearchAndReplaceInSelection(original, modified);
              } else {
                await onSearchAndReplace(original, modified);
              }
            }
            applied = true;
          }
        } catch (e) {
          console.error("Granular replacement failed:", e);
        }
      }

      // Fallback: If no replacements were applied, use the full text replacement
      if (!applied) {
        console.warn("No granular replacements found, using legacy full-text replacement.");
        if (improveTarget === 'DOCUMENT') {
          if (onUpdateDocumentPreservingStyles) {
            await onUpdateDocumentPreservingStyles(improvementResult.rewrittenText);
          } else {
            onUpdateDocument(improvementResult.rewrittenText);
          }
        } else {
          onUpdateSelection(improvementResult.rewrittenText);
        }
      }

      // Option 1: Do NOT save actions to history.

      setImprovementResult(null);
      setImproveTarget(null);
      setViewState('LIST');
    }
  };

  // Dismiss the improvement and return to list without applying
  const handleDismissImprovement = () => {
    setImprovementResult(null);
    setImproveTarget(null);
    setViewState('LIST');
  };

  const handleTranslateRun = async () => {
    setLoading(true);
    setErrorMessage(null); // Clear any previous errors
    try {
      // Senior Dev Implementation: Structural Translation
      const isSelection = !!selection && selection.trim().length > 0;

      if (isSelection) {
        // 1. Split selection into lines to preserve structure but translate only content
        // We use a regex to split by any newline character sequence
        const lines = selection.split(/\r\n|\r|\n/);

        // 2. Create segments for non-empty lines
        // We keep track of the original index (id) to reconstruct the text later
        const segmentsToTranslate = lines
          .map((text, index) => ({ id: index, text }))
          .filter(seg => seg.text.trim().length > 0);

        if (segmentsToTranslate.length === 0) {
          alert(String(t('actionsView.errorTranslatingDocument')) + " (No text found in selection)");
          setLoading(false);
          return;
        }

        // 3. Translate structurally
        const translatedSegments = await translateDocumentStructurally(segmentsToTranslate, selectedLanguage);

        // 4. Reconstruct the text
        const translationMap = new Map(translatedSegments.map(s => [s.id, s.text]));

        const finalLines = lines.map((line, index) => {
          if (translationMap.has(index)) {
            return translationMap.get(index) || line;
          }
          return line; // Keep empty/whitespace lines as is
        });

        // 5. Apply update to selection only
        await onUpdateSelection(finalLines.join('\n'));

      } else {
        // Document Mode (Legacy Structural)
        // 1. Get segments from the whole document
        const segments = await getParagraphsForTranslation();

        if (segments.length === 0) {
          alert(
            `${String(t('actionsView.errorTranslatingDocument'))} (${String(t('actionsView.noTextFound'))})`
          );
          setLoading(false);
          return;
        }

        // 2. Translate structurally
        const translatedSegments = await translateDocumentStructurally(segments, selectedLanguage);

        // 3. Apply updates in-place to paragraphs
        await applyTranslationToParagraphs(translatedSegments);
      }

      // Option 1: Do NOT save actions to history.

      setViewState('LIST');
    } catch (e) {
      setErrorMessage(
        `${String(t('actionsView.errorTranslatingDocument'))}: ${e instanceof Error ? e.message : String(e)}`
      );
      alert(String(t('actionsView.errorTranslatingDocument')));
    } finally {
      setLoading(false);
    }
  };


  // Minimal fallback summary when AI doesn't return explicit changes.
  // Choice made by assistant (per plan): Compare placeholders before/after for [..] and {{..}}.
  const computePlaceholderFallback = (before: string, after: string): TemplateChangeItem[] => {
    const bracketRegex = /\[([^\[\]\n]+?)\]/g;
    const mustacheRegex = /\{\{\s*([^{}]+?)\s*\}\}/g;
    const collect = (text: string, r: RegExp) => {
      const out: string[] = [];
      let m;
      while ((m = r.exec(text)) !== null) out.push(m[0]);
      return out;
    };
    const beforeMatches = [...collect(before, bracketRegex), ...collect(before, mustacheRegex)];
    // reset regex lastIndex for re-use
    bracketRegex.lastIndex = 0;
    mustacheRegex.lastIndex = 0;
    const afterMatches = [...collect(after, bracketRegex), ...collect(after, mustacheRegex)];
    const removedCount = Math.max(0, beforeMatches.length - afterMatches.length);

    const items: TemplateChangeItem[] = [];
    for (let i = 0; i < removedCount; i++) {
      items.push({ type: 'removed', title: String(t('actionsView.removedPlaceholderText')) });
    }
    const remainingUnique = Array.from(new Set(afterMatches)).slice(0, 5);
    remainingUnique.forEach((ph) => {
      items.push({
        type: 'updated',
        title: String(t('actionsView.placeholderLeft')).replace('{0}', ph),
      });
    });
    return items;
  };


  const handleFillTemplateRun = async () => {
    // Support both Reference Docs and Knowledge Base docs
    let referenceContent = "";
    let docName = "";

    if (selectedReferenceDocId) {
      const refDoc = referenceDocs.find(d => d.id === selectedReferenceDocId);
      if (!refDoc) {
        setErrorMessage(String(t('actionsView.selectReferenceDoc')));
        return;
      }
      referenceContent = refDoc.content;
      docName = refDoc.name;
    } else if (selectedKnowledgeDocId) {
      const knowledgeDoc = knowledgeDocs.find(d => d.id === selectedKnowledgeDocId);
      if (!knowledgeDoc) {
        setErrorMessage(String(t('actionsView.selectKnowledgeDoc')));
        return;
      }

      // Fetch content from Knowledge Base document
      setLoading(true);
      try {
        const { content, error } = await fetchKnowledgeDocContent(knowledgeDoc);
        if (error || !content) {
          setErrorMessage(
            `${String(t('actionsView.failedToLoadDocContent'))}: ${error || String(t('actionsView.unknownError'))}`
          );
          setLoading(false);
          return;
        }
        referenceContent = content;
        docName = knowledgeDoc.name;
      } catch (e) {
        setErrorMessage(
          `${String(t('actionsView.errorLoadingDocument'))}: ${e instanceof Error ? e.message : String(e)}`
        );
        setLoading(false);
        return;
      }
    } else {
      setErrorMessage(String(t('actionsView.selectReferenceOrKnowledgeDoc')));
      return;
    }

    setLoading(true);
    setErrorMessage(null); // Clear any previous errors
    try {
      const originalDoc = documentContent;
      const historyTitle = String(t('actionsView.historyFilledTemplate'));
      const historyDescBase = String(t('actionsView.historyFilledTemplateDescription')).replace('{0}', docName);

      if (originalDocBuffer) {
        // Binary Mode
        const data = await getTemplateData(originalDoc, referenceContent);
        const filledBlob = fillDocxTemplate(originalDocBuffer, data);
        const filledBuffer = await filledBlob.arrayBuffer();

        onUpdateOriginalDocBuffer(filledBuffer);

        const newText = await parseDocxText(filledBuffer);
        onUpdateDocument(newText);

        const changes: TemplateChangeItem[] = Object.entries(data).map(([key, value]) => ({
          type: 'updated',
          title: String(t('actionsView.filledPlaceholder')).replace('{0}', key),
          value: String(value).substring(0, 50) + (String(value).length > 50 ? '...' : '')
        }));

        setTemplateChanges(changes);

        // Option 1: Do NOT save actions to history.
      } else {
        // Text Mode (Fallback)
        const { filledDocument, changes } = await fillTemplateWithSummary(originalDoc, referenceContent);
        onUpdateDocument(filledDocument);

        // Option 1: Do NOT save actions to history.
        const finalChanges = (changes && changes.length > 0) ? changes : computePlaceholderFallback(originalDoc, filledDocument);
        setTemplateChanges(finalChanges);
      }

      setLastRefDocName(docName);
      setViewState('FIELD_TEMPLATE_RESULT');
      setSelectedReferenceDocId(null);
      setSelectedKnowledgeDocId(null);
    } catch (e) {
      setErrorMessage(
        `${String(t('actionsView.errorFillingTemplate'))}: ${e instanceof Error ? e.message : String(e)}`
      );
      alert(String(t('actionsView.errorFillingTemplate')));
    } finally {
      setLoading(false);
    }
  };

  const ActionItem = ({ icon: Icon, title, description, onClick }: any) => (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 w-full p-4 hover:bg-white/40 rounded-xl transition-all text-left group"
    >
      <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center text-slate-500 shadow-sm border border-white/40 group-hover:scale-105 transition-transform">
        <Icon size={20} />
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </button>
  );

  const filteredLanguages = LANGUAGES.filter(l =>
    l.name.toLowerCase().includes(languageSearch.toLowerCase())
  );

  if (viewState === 'TRANSLATE') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.translateModal.title'))}</h2>
          </div>
          <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Error message display (replaces window.alert which is not supported in Office.js) */}
        {errorMessage && (
          <div className="px-4 pt-2">
            <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg border bg-red-50 border-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 text-red-600 flex-shrink-0" />
                <div className="text-xs text-red-700 flex-1">{errorMessage}</div>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-red-700 flex-shrink-0"
                title={String(t('common.dismiss'))}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="p-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={String(t('actions.translateModal.searchLanguage'))}
              value={languageSearch}
              onChange={(e) => setLanguageSearch(e.target.value)}
              className="w-full bg-white/60 border border-white/50 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-indigo-300 transition-colors placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-20">
          <div className="space-y-1">
            {filteredLanguages.map((lang) => (
              <button
                key={lang.name}
                onClick={() => setSelectedLanguage(lang.name)}
                className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-white/50 transition-colors text-left"
              >
                <div className="w-6 h-4 flex-shrink-0 overflow-hidden rounded-sm shadow-sm border border-slate-200/50">
                  <img
                    src={`https://flagcdn.com/w40/${lang.code}.png`}
                    srcSet={`https://flagcdn.com/w80/${lang.code}.png 2x`}
                    width="24"
                    height="16"
                    alt={lang.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className={`text-sm flex-1 ${selectedLanguage === lang.name ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {lang.name}
                </span>
                {selectedLanguage === lang.name && (
                  <CheckIcon size={16} className="text-slate-900" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Floating Bottom Button */}
        <div className="absolute bottom-6 left-0 right-0 px-6 pointer-events-none">
          <button
            onClick={handleTranslateRun}
            disabled={loading}
            className="w-full bg-slate-900 text-white font-medium py-3 rounded-full hover:bg-slate-800 transition-colors shadow-xl pointer-events-auto flex justify-center items-center gap-2 backdrop-blur-sm"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {String(t('actions.translateModal.translating'))}
              </span>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                {selection && selection.trim().length > 0
                  ? String(t('actions.translateModal.translateSelection'))
                  : String(t('actions.translateModal.translateDocument'))}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (viewState === 'ANONYMIZE') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.back'))} title={String(t('common.back'))}>
              <ChevronLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.anonymiseModal.title'))}</h2>
          </div>
          <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Category selection */}
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">{String(t('actions.anonymiseModal.categoriesToDetect'))}</h3>
            {Object.entries(anonymizeOptions).map(([key, value]) => (
              <label key={key} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/50 cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${value ? 'bg-indigo-600 border-indigo-600 shadow-md' : 'border border-slate-300 bg-white/60'}`}>
                    {value && <CheckIcon size={14} className="text-white" />}
                  </div>
                  <span className="text-sm font-medium text-slate-700">{String(t(`anonymizeCategories.${key}`))}</span>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={value}
                    onChange={() => setAnonymizeOptions(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                  />
                </div>
                <span className="text-xs text-slate-500 bg-white/60 px-2 py-0.5 rounded border border-white/40">[{String(t(`anonymizeCategories.${key}`)).toUpperCase()}]</span>
              </label>
            ))}
          </div>

          {/* Custom terms section */}
          <div className="pt-4 border-t border-white/30">
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-3">{String(t('actions.anonymiseModal.customTermsToRedact'))}</h3>

            {/* Custom terms list */}
            {customTerms.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {customTerms.map((term) => (
                  <span
                    key={term}
                    className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full"
                  >
                    {term}
                    <button
                      onClick={() => handleRemoveCustomTerm(term)}
                      className="hover:text-indigo-600"
                      aria-label="Remove term"
                      title="Remove term"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add custom term input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newCustomTerm}
                onChange={(e) => setNewCustomTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddCustomTerm()}
                placeholder={String(t('actions.anonymiseModal.addCustomTerm'))}
                className="flex-1 bg-white/60 border border-white/50 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-300 transition-colors placeholder:text-slate-400"
              />
              <button
                onClick={handleAddCustomTerm}
                disabled={!newCustomTerm.trim()}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Add term"
                title="Add term"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Info about what will be anonymized */}
          <div className="pt-4 border-t border-white/30">
            <div className="bg-blue-50/80 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                {(() => {
                  // Utility to match Word's character count: exclude line endings and invisible chars
                  const getWordCharCount = (text: string) => {
                    // Remove \r and \n, and invisible unicode chars
                    return text.replace(/[\r\n\u200B\u200C\u200D\uFEFF]/g, '').length;
                  };
                  const count = selection
                    ? getWordCharCount(selection)
                    : getWordCharCount(documentContent);
                  return (selection
                    ? String(t('actions.anonymiseModal.willAnonymizeSelection')).replace('{0}', count.toString())
                    : String(t('actions.anonymiseModal.willAnonymizeDocument')).replace('{0}', count.toString())
                  );
                })()}
              </p>
            </div>
          </div>

          {/* Error display */}
          {anonymizeError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">{anonymizeError}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/30 space-y-2">
          {/* Preview button */}
          <button
            onClick={handleAnonymizePreview}
            disabled={previewLoading}
            className="w-full bg-white border border-slate-300 text-slate-700 font-medium py-3 rounded-xl hover:bg-slate-50 transition-colors shadow-sm flex justify-center items-center gap-2"
          >
            {previewLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {String(t('actions.anonymiseModal.analyzing'))}
              </>
            ) : (
              <>
                <Eye size={16} />
                {String(t('actions.anonymiseModal.previewButton'))}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Anonymize Preview View
  if (viewState === 'ANONYMIZE_PREVIEW') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setViewState('ANONYMIZE')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.back'))} title={String(t('common.back'))}>
              <ChevronLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.anonymisePreview.title'))}</h2>
          </div>
          <button onClick={() => { setViewState('LIST'); setPreviewResult(null); }} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Detected terms */}
          {previewResult && previewResult.detectedTerms.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                {String(t('actions.anonymisePreview.detectedSensitiveItems')).replace('{0}', previewResult.detectedTerms.length.toString())}
              </h3>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {previewResult.detectedTerms.slice(0, 50).map((term, idx) => (
                  <span
                    key={`${term}-${idx}`}
                    className="inline-block bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full"
                  >
                    {term.length > 30 ? term.substring(0, 30) + '...' : term}
                  </span>
                ))}
                {previewResult.detectedTerms.length > 50 && (
                  <span className="text-xs text-slate-500">
                    {String(t('actions.anonymisePreview.moreItems')).replace('{0}', (previewResult.detectedTerms.length - 50).toString())}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Preview text */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">{String(t('actions.anonymisePreview.anonymizedPreview'))}</h3>
            <div className="bg-white/80 border border-slate-200 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono">
                {previewResult?.anonymizedText || String(t('actions.anonymisePreview.noPreview'))}
              </pre>
            </div>
          </div>

          {/* Warning about local fallback */}
          {useLocalFallback && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                {String(t('actions.anonymisePreview.localWarning1'))}
                {' '}
                {String(t('actions.anonymisePreview.localWarning2'))}
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/30 space-y-2">
          <button
            onClick={handleAnonymizeRun}
            disabled={loading}
            className="w-full bg-slate-800 text-white font-medium py-3 rounded-xl hover:bg-slate-900 transition-colors shadow-lg shadow-slate-300/50 disabled:opacity-70 flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {String(t('actions.anonymisePreview.applying'))}
              </>
            ) : (
              <>
                <Check size={16} />
                {String(t('actions.anonymisePreview.applyButton'))}
              </>
            )}
          </button>
          <button
            onClick={() => setViewState('ANONYMIZE')}
            disabled={loading}
            className="w-full bg-white border border-slate-300 text-slate-600 font-medium py-2 rounded-xl hover:bg-slate-50 transition-colors"
          >
            {String(t('actions.anonymisePreview.backToSettings'))}
          </button>
        </div>
      </div>
    );
  }

  if (viewState === 'IMPROVE_OPTIONS') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.back'))} title={String(t('common.back'))}>
              <ChevronLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.improveWriting'))}</h2>
          </div>
          <button type="button" onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 p-4 flex flex-col gap-4">
          <p className="text-slate-600 text-sm mb-2">{String(t('actions.improveOptions.choosePrompt'))}</p>

          <button
            type="button"
            onClick={handleImproveSelection}
            className="flex items-center gap-4 p-4 bg-white/60 border border-white/50 rounded-xl hover:bg-white/80 transition-all shadow-sm text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center text-slate-500 shadow-sm border border-white/40 group-hover:scale-105 transition-transform">
              <PenLine size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{String(t('actions.improveOptions.selectionTitle'))}</h3>
              <p className="text-xs text-slate-500">{String(t('actions.improveOptions.selectionDescription'))}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleImproveDocument}
            className="flex items-center gap-4 p-4 bg-white/60 border border-white/50 rounded-xl hover:bg-white/80 transition-all shadow-sm text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center text-slate-500 shadow-sm border border-white/40 group-hover:scale-105 transition-transform">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{String(t('actions.improveOptions.documentTitle'))}</h3>
              <p className="text-xs text-slate-500">{String(t('actions.improveOptions.documentDescription'))}</p>
            </div>
          </button>
        </div>

        {loading && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 backdrop-blur-md">
            <div className="flex flex-col items-center">
              <div className="animate-spin text-slate-800 mb-4">
                <RefreshCw size={32} />
              </div>
              <span className="text-sm font-semibold text-slate-600">{String(t('actions.workflowInProgress'))}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Improve Writing Preview View - matches AssistantView design for consistency
  if (viewState === 'IMPROVE_PREVIEW' && improvementResult) {
    return (
      <div className="h-full flex flex-col bg-transparent">
        {/* Header - matches AssistantView */}
        <div className="bg-white/40 backdrop-blur-md px-4 py-3 border-b border-white/30 flex justify-between items-center">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{String(t('actions.improvePreview.title'))}</h2>
            <span className="text-xs text-slate-500">
              {String(t('actions.improvePreview.availableCount')).replace('{0}', '1')}
            </span>
          </div>
          <button className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1">
            {String(t('actions.improvePreview.collapseAll'))} <ChevronUp size={14} />
          </button>
        </div>

        {/* Main content - single card with numbered badge */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-white/60 backdrop-blur-md rounded-xl shadow-sm border border-white/50 overflow-hidden">
            {/* Card header with numbered badge and explanation */}
            <div className="w-full text-left p-4 flex items-start gap-3 border-b border-white/30">
              <div className="flex-shrink-0 w-6 h-6 rounded bg-green-200/80 text-green-800 flex items-center justify-center text-xs font-bold">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-800 leading-tight pr-4">
                  {improvementResult.explanation}
                </h3>
              </div>
              <ChevronDown size={16} className="text-slate-400" />
            </div>

            {/* Card body with description, diff, and inline buttons */}
            <div className="px-4 pb-4 pt-2">
              <div className="text-sm text-slate-700 mb-3 leading-relaxed">{String(t('actions.improvePreview.defaultDescription'))}</div>

              {/* Diff Box */}
              <div className="bg-slate-50/50 rounded-lg p-3 text-sm font-serif leading-relaxed border border-slate-100/50 text-slate-600 mb-4">
                {renderDiff(improvementResult.diffMarkup)}
              </div>

              {/* Inline action buttons - Show / Dismiss / Apply */}
              <div className="flex items-center gap-2">
                <button className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80 transition-colors">
                  {String(t('actions.improvePreview.show'))}
                </button>
                <button
                  onClick={handleDismissImprovement}
                  className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80 transition-colors"
                >
                  {String(t('actions.improvePreview.dismiss'))}
                </button>
                <button
                  onClick={handleApplyImprovement}
                  className="flex-1 py-1.5 text-xs font-medium text-white bg-slate-900/90 border border-slate-900 rounded-lg hover:opacity-90 flex items-center justify-center gap-1 shadow-md"
                >
                  {String(t('actions.improvePreview.apply'))} <ChevronDown size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === 'FIELD_TEMPLATE') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.back'))} title={String(t('common.back'))}>
              <ChevronLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.fillTemplateView.title'))}</h2>
          </div>
          <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="p-4 border-b border-white/30">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={String(t('actions.fillTemplateView.searchPlaceholder'))}
              value={attachmentSearch}
              onChange={(e) => setAttachmentSearch(e.target.value)}
              className="w-full bg-white/60 border border-white/50 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-indigo-300 transition-colors"
            />
          </div>
        </div>

        {/* Error message display (replaces window.alert which is not supported in Office.js) */}
        {errorMessage && (
          <div className="px-4 pt-3">
            <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg border bg-red-50 border-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 text-red-600 flex-shrink-0" />
                <div className="text-xs text-red-700 flex-1">{errorMessage}</div>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-red-700 flex-shrink-0"
                title={String(t('common.dismiss'))}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Upload status banner - shows success/error/progress for document uploads */}
        {uploadStatus.state !== 'idle' && (
          <div className="px-4 pt-3">
            <div className={`flex items-start justify-between gap-2 px-3 py-2 rounded-lg border ${uploadStatus.state === 'error'
              ? 'bg-red-50 border-red-200'
              : uploadStatus.state === 'done'
                ? 'bg-green-50 border-green-200'
                : 'bg-blue-50 border-blue-200'
              }`}>
              <div className="flex items-start gap-2">
                {uploadStatus.state === 'error' && (
                  <AlertCircle size={16} className="mt-0.5 text-red-600 flex-shrink-0" />
                )}
                {uploadStatus.state === 'done' && (
                  <Check size={16} className="mt-0.5 text-green-600 flex-shrink-0" />
                )}
                {(uploadStatus.state === 'validating' || uploadStatus.state === 'uploading') && (
                  <Loader2 size={16} className="mt-0.5 text-blue-600 flex-shrink-0 animate-spin" />
                )}
                <div className={`text-xs flex-1 ${uploadStatus.state === 'error'
                  ? 'text-red-700'
                  : uploadStatus.state === 'done'
                    ? 'text-green-700'
                    : 'text-blue-700'
                  }`}>
                  {uploadStatus.message}
                </div>
              </div>
              {(uploadStatus.state === 'done' || uploadStatus.state === 'error') && (
                <button
                  onClick={() => setUploadStatus({ state: 'idle' })}
                  className={`flex-shrink-0 ${uploadStatus.state === 'error'
                    ? 'text-red-400 hover:text-red-700'
                    : 'text-green-400 hover:text-green-700'
                    }`}
                  title={String(t('common.dismiss'))}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Loading skeletons while fetching docs */}
          {docsLoading && (
            <div className="px-2 py-1 space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 rounded-lg border border-transparent bg-white/40 animate-pulse"
                >
                  <div className="w-5 h-5 rounded border border-slate-200 bg-white/60" />
                  <div className="w-8 h-10 flex items-center justify-center bg-white shadow-sm border border-slate-100 rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="h-4 w-2/3 bg-slate-200/70 rounded" />
                    <div className="mt-2 h-3 w-1/3 bg-slate-200/60 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Knowledge Docs */}
          {knowledgeDocs.length > 0 && (
            <div className="px-2 py-1">
              <h3 className="text-[10px] font-semibold text-slate-400 uppercase mb-2">{String(t('actions.fillTemplateView.knowledge'))}</h3>
              <div className="space-y-1">
                {knowledgeDocs
                  .filter(d => matchesAttachmentSearch(d.name ?? null))
                  .map(doc => {
                    const ext = (doc.extension || doc.mime_type || '').toString().toLowerCase();
                    const isPdf = ext.includes('pdf');
                    const status = (doc.status || '').toString().toLowerCase();
                    const isSelected = selectedKnowledgeDocId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        onClick={() => {
                          // Toggle selection: if already selected, deselect it; otherwise select it
                          if (isSelected) {
                            setSelectedKnowledgeDocId(null);
                          } else {
                            setSelectedKnowledgeDocId(doc.id);
                            setSelectedReferenceDocId(null); // Deselect Reference Doc when selecting Knowledge Doc
                          }
                        }}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-indigo-50/80 border border-indigo-200 shadow-sm' : 'hover:bg-white/50 border border-transparent'}`}
                      >
                        {/* Checkbox-style selection indicator */}
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white/60'}`}>
                          {isSelected && <CheckIcon size={12} className="text-white" />}
                        </div>
                        <div className="w-8 h-10 flex items-center justify-center bg-white shadow-sm border border-slate-100 rounded text-slate-500">
                          {isPdf ? <div className="text-[9px] font-bold text-red-500">{String(t('actions.fillTemplateView.pdfBadge'))}</div> : <div className="text-[9px] font-bold text-blue-500">{String(t('actions.fillTemplateView.docBadge'))}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-slate-800 truncate">{doc.name}</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                            <span className="capitalize">{isPdf ? String(t('actions.fillTemplateView.pdfDocument')) : String(t('actions.fillTemplateView.docxDocument'))}</span>
                            <span>•</span>
                            <span>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}</span>
                            {status && (
                              <>
                                <span>•</span>
                                <span className={`px-2 py-0.5 rounded-full border text-[10px] ${status === 'ready' ? 'bg-green-50 text-green-700 border-green-200' :
                                  status === 'processing' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                    'bg-slate-50 text-slate-600 border-slate-200'
                                  }`}>
                                  {status === 'ready' ? String(t('actions.fillTemplateView.statusReady')) : status === 'processing' ? String(t('actions.fillTemplateView.statusProcessing')) : status}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {referenceDocs.length === 0 && knowledgeDocs.length === 0 && !docsLoading && !loading && (
            <div className="p-4 text-center text-sm text-slate-500">
              {String(t('actions.fillTemplateView.noDocuments'))}
            </div>
          )}

          {/* Reference Docs */}
          {referenceDocs
            .filter(d => matchesAttachmentSearch(d.name ?? null))
            .map(doc => {
              const isSelected = selectedReferenceDocId === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    // Toggle selection: if already selected, deselect it; otherwise select it
                    if (isSelected) {
                      setSelectedReferenceDocId(null);
                    } else {
                      setSelectedReferenceDocId(doc.id);
                      setSelectedKnowledgeDocId(null); // Deselect Knowledge Doc when selecting Reference Doc
                    }
                  }}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-indigo-50/80 border border-indigo-200 shadow-sm' : 'hover:bg-white/50 border border-transparent'}`}
                >
                  {/* Checkbox-style selection indicator */}
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white/60'}`}>
                    {isSelected && <CheckIcon size={12} className="text-white" />}
                  </div>

                  {/* File Icon */}
                  <div className="w-8 h-10 flex items-center justify-center bg-white shadow-sm border border-slate-100 rounded text-slate-500">
                    {doc.type === 'pdf' ? <div className="text-[9px] font-bold text-red-500">{String(t('actions.fillTemplateView.pdfBadge'))}</div> : <div className="text-[9px] font-bold text-blue-500">{String(t('actions.fillTemplateView.docBadge'))}</div>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-slate-800 truncate">{doc.name}</h4>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                      <span>{doc.type === 'docx' ? String(t('actions.fillTemplateView.docxDocument')) : String(t('actions.fillTemplateView.pdfDocument'))}</span>
                      <span>•</span>
                      <span>{doc.doc_date}</span>
                    </div>
                  </div>
                </div>
              )
            })}
        </div>

        <div className='flex flex-col sm:flex-row gap-2 w-full p-4 border-t border-white/30'>
          <div className="flex justify-center sm:justify-start">
            {/* Hidden file input used to open the native file picker */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={getAcceptForSmartDrafting()}
              multiple
              onChange={handleFilesSelected}
            />
            <button
              onClick={handleAddDocumentsClick}
              disabled={uploadStatus.state === 'uploading' || uploadStatus.state === 'validating'}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg hover:bg-white/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Plus size={16} /> {String(t('actions.fillTemplateView.addDocuments'))}
            </button>
          </div>

          <div className="flex-1">
            <button
              onClick={handleFillTemplateRun}
              disabled={(!selectedReferenceDocId && !selectedKnowledgeDocId) || loading}
              className="w-full bg-slate-900 text-white font-medium py-3 rounded-xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-300/50 disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {loading ? String(t('actions.fillTemplateView.fillingTemplate')) : (
                <>
                  <Play size={16} fill="currentColor" />
                  {String(t('actions.fillTemplateView.fillInTemplate'))}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Result View for the FIELD_TEMPLATE flow (added per user request)
  if (viewState === 'FIELD_TEMPLATE_RESULT') {
    return (
      <div className="h-full flex flex-col bg-white/90 backdrop-blur-xl absolute inset-0 z-30">
        <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.back'))} title={String(t('common.back'))}>
              <ChevronLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="font-bold text-lg text-slate-800">{String(t('actions.fillTemplateResult.titlePrefix'))} {lastRefDocName || String(t('actions.fillTemplateResult.titleFallback'))}</h2>
          </div>
          <button onClick={() => setViewState('LIST')} className="p-1 hover:bg-white/50 rounded-full" aria-label={String(t('common.close'))} title={String(t('common.close'))}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="space-y-1">
            {templateChanges.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-10">
                {String(t('actions.fillTemplateResult.noChanges'))}
              </div>
            )}
            {templateChanges.map((item, idx) => {
              const isExpanded = expandedItems.has(idx);
              const hasValue = !!item.value;
              const toggleExpand = () => {
                if (!hasValue) return;
                setExpandedItems(prev => {
                  const next = new Set(prev);
                  if (next.has(idx)) {
                    next.delete(idx);
                  } else {
                    next.add(idx);
                  }
                  return next;
                });
              };

              return (
                <div key={`${item.title}-${idx}`} className="flex flex-col">
                  <button
                    onClick={toggleExpand}
                    disabled={!hasValue}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/60 border border-transparent w-full text-left ${hasValue ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-400 w-8 text-right">{idx + 1}</span>
                      <span className="text-sm text-slate-800">
                        {item.title}
                      </span>
                    </div>
                    {hasValue && (
                      isExpanded
                        ? <ChevronUp size={16} className="text-slate-400" />
                        : <ChevronDown size={16} className="text-slate-400" />
                    )}
                  </button>
                  {isExpanded && item.value && (
                    <div className="ml-11 mr-3 mb-2 px-3 py-2 bg-slate-50/80 rounded-lg text-sm text-slate-600 border border-slate-100">
                      {item.value}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="px-4 py-3">
        <h2 className="text-lg font-bold text-slate-800 mb-3">{String(t('actions.title'))}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        <ActionItem
          icon={Languages}
          title={String(t('actions.translate'))}
          description={String(t('actions.translateDescription'))}
          onClick={() => setViewState('TRANSLATE')}
        />
        <ActionItem
          icon={PenLine}
          title={String(t('actions.fillTemplate'))}
          description={String(t('actions.fillTemplateDescription'))}
          onClick={() => setViewState('FIELD_TEMPLATE')}
        />
        <ActionItem
          icon={RefreshCw}
          title={String(t('actions.anonymise'))}
          description={String(t('actions.anonymiseDescription'))}
          onClick={() => setViewState('ANONYMIZE')}
        />
        <ActionItem
          icon={FileEdit}
          title={String(t('actions.improveWriting'))}
          description={String(t('actions.improveWritingDescription'))}
          onClick={handleImprove}
        />
      </div>

      {loading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 backdrop-blur-md">
          <div className="flex flex-col items-center">
            <div className="animate-spin text-slate-800 mb-4">
              <RefreshCw size={32} />
            </div>
            <span className="text-sm font-semibold text-slate-600">{String(t('actions.workflowInProgress'))}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper Icon
const CheckIcon = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);
