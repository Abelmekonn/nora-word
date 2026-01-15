
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { draftContent, improveWriting } from '../services/aiService';
import { askNora } from '../services/noraChatService';
import { addToHistory, createChatSession, fetchChatMessages, saveChatMessage } from '../services/dataService';
import { FileText, Folder, Sparkles, X, ChevronDown, ChevronUp, Lock, Globe } from 'lucide-react';

// Helper function to parse file metadata from message and create display version
// User request: Hide extracted text from display, show only document icon
function parseMessageWithFiles(text: string): { displayText: string; files: Array<{ name: string; id: string }> } {
  const fileMetadataRegex = /\[__FILES__:(.+?)\]$/s;
  const match = text.match(fileMetadataRegex);

  let files: Array<{ name: string; id: string }> = [];
  if (match) {
    try {
      files = JSON.parse(match[1]);
    } catch (e) {
      console.error('Failed to parse file metadata:', e);
    }
  }

  // Remove file metadata marker first
  let displayText = text.replace(fileMetadataRegex, '');

  // Remove ALL "--- Content from [filename] ---" sections and everything that follows them
  // This is the extracted text that should be hidden from display
  // Match pattern: "--- Content from filename ---" followed by any content until:
  // - Next "--- Content from" section
  // - File metadata marker
  // - End of string

  // First, split by "--- Content from" to isolate sections
  const parts = displayText.split(/--- Content from [^\n]+ ---/);

  // Keep only the first part (user's actual message, before any file content)
  // This ensures we only show what the user typed, not the extracted text
  if (parts.length > 0) {
    displayText = parts[0].trim();
  } else {
    displayText = displayText.trim();
  }

  // Final cleanup: remove any trailing newlines and whitespace
  displayText = displayText.replace(/\n{3,}/g, '\n\n').trim();

  return { displayText, files };
}
import { ViewState, ImprovementResult } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface AssistantViewProps {
  documentContent: string;
  selection?: string;
  onInsert: (text: string) => void | Promise<void>;
  onReplace?: (text: string) => void | Promise<void>;
  /** Search and replace within current selection (for granular Track Changes) */
  onSearchAndReplaceInSelection?: (searchText: string, replaceText: string) => Promise<number>;
  // Expose the chat handler to the parent to link with the bottom input
  setExternalHandler: (handler: (msg: string) => Promise<void>) => void;
  onNavigate: (view: ViewState, action?: 'ANONYMIZE' | 'TRANSLATE' | null) => void;
  // Notify parent about loading state for UX control (optional)
  onLoadingChange?: (loading: boolean) => void;
  // Added per user request: provides a way to clear current selection from parent,
  // used by the dismiss (X) button in the floating highlight bar.
  // This was explicitly requested by the user to make the X button functional without
  // modifying the document content.
  onClearSelection?: () => void;
  /**
   * initialSessionId
   * Explicit per user request: when navigating from History, preload the related chat
   * session in the Assistant tab. If provided, we fetch and hydrate the chat UI.
   * Reasoning (assistant's decision): keep this optional so default behavior remains unchanged.
   */
  initialSessionId?: string;
  /**
   * initialImprovement
   * Explicit per user request: when navigating from History, preload the improvement result.
   */
  initialImprovement?: ImprovementResult | null;
}

export const AssistantView: React.FC<AssistantViewProps> = ({ documentContent, selection, onInsert, onReplace, onSearchAndReplaceInSelection, setExternalHandler, onNavigate, onLoadingChange, onClearSelection, initialSessionId, initialImprovement }) => {
  const [chatHistory, setChatHistory] = useState<Array<{
    role: 'user' | 'model',
    text: string,
    files?: Array<{ name: string; id: string }> // File attachments for display
  }>>([]);
  const [loading, setLoading] = useState(false);
  /**
   * sessionId
   * Explicit per user request: persist chat sessions so History items can reload.
   * Reasoning (assistant's decision): Option B uses a `word_chat_sessions` row as the
   * conversation id, and `word_chat_messages` rows for each message.
   */
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  // Tracks whether we've already written a history row for the current session.
  // This prevents spamming History with one entry per message.
  const historySessionLoggedRef = useRef<string | null>(initialSessionId ?? null);
  // Added per user request: personalize greeting using the authenticated user's first name.
  // Reasoning (assistant's decision): Prefer profile fields, then display name, then full name, then email prefix to ensure a friendly default.
  const { user, profile } = useAuth();
  const { t, language } = useLanguage();
  const firstNameFromDisplayName = profile?.displayName?.split(' ')[0];
  const fullNameRaw: unknown = user?.user_metadata?.full_name;
  const firstNameFromFullName = typeof fullNameRaw === 'string' ? fullNameRaw.split(' ')[0] : undefined;
  const firstNameFromEmail = user?.email ? user.email.split('@')[0] : '';
  const firstName = profile?.firstName || firstNameFromDisplayName || firstNameFromFullName || firstNameFromEmail;

  // Improvement State
  const [improvementResult, setImprovementResult] = useState<ImprovementResult | null>(initialImprovement ?? null);
  const [showImprovementView, setShowImprovementView] = useState(!!initialImprovement);
  const [isImproving, setIsImproving] = useState(false);

  // Dropdown state for floating highlight bar actions menu
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset improvement view if selection clears
  useEffect(() => {
    if (!selection) {
      setShowImprovementView(false);
      setImprovementResult(null);
      setShowActionDropdown(false);
    }
  }, [selection]);

  // Click-outside handler for action dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowActionDropdown(false);
      }
    };

    if (showActionDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionDropdown]);

  /**
   * ensureSessionId
   * Explicit per user request: create a chat session lazily on first message for a new chat.
   * Reasoning (assistant's decision): do not create empty sessions unless a message is sent.
   */
  const ensureSessionId = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    const newId = await createChatSession(String(t('assistantView.sessionTitleChat')));
    if (newId) {
      setSessionId(newId);
      // Since this is a brand-new session, it has no history row yet.
      historySessionLoggedRef.current = null;
    }
    return newId;
  }, [sessionId]);

  // Memoize handler to prevent stale closures
  // Updated to use nora-ai backend via askNora service for intelligent legal AI responses
  const handleDraft = useCallback(async (prompt: string) => {
    // Defensive guard: we should only ever receive a non-empty string prompt.
    // This prevents "Invalid question" and prevents accidentally attempting to persist
    // non-serializable objects (e.g., Promises) into Supabase.
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      setChatHistory(prev => [
        ...prev,
        { role: 'model', text: String(t('assistantView.errorPromptRequired')) }
      ]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Ensure we have a chat session id to persist messages/history against.
    // If creation fails, we still show the response but skip persistence gracefully.
    const sid = await ensureSessionId();
    if (!sid) {
      setChatHistory(prev => [...prev, { role: 'model', text: String(t('assistantView.errorFailedToStartSession')) }]);
      setLoading(false);
      return;
    }

    // Optimistic UI
    const { displayText, files } = parseMessageWithFiles(prompt);
    setChatHistory(prev => [...prev, { role: 'user', text: displayText, files }]);
    // Persist user message
    void saveChatMessage(sid, 'user', prompt);

    // Yield to let UI update before network request (prevents thread blocking with large payloads)
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      // Use nora-ai backend for intelligent legal assistant responses
      // Pass the workspace language so AI responds in the correct language
      const response = await askNora(prompt, language);

      if (response.success && response.answer) {
        setChatHistory(prev => [...prev, { role: 'model', text: response.answer! }]);
        setLoading(false); // Stop loading immediately after showing response
        // Persist assistant message (only if session id exists)
        if (sid) {
          void saveChatMessage(sid, 'assistant', response.answer);
        }

        // Log to history ONCE per session, and store the session id in metadata.
        // This is the critical link that makes History → click → reload work.
        if (sid && historySessionLoggedRef.current !== sid) {
          historySessionLoggedRef.current = sid;
          // Await so failures are visible during debugging (RLS/workspace mismatch).
          // Explicit per user request: new chats must show up in History.
          const histRes = await addToHistory(
            'CHAT',
            String(t('assistantView.historyTitleChat')),
            `Asked: "${prompt.substring(0, 50)}..." (${response.type || 'general'})`,
            { chat_session_id: sid }
          );
          if (!histRes.ok) {
            console.error('[AssistantView] Failed to write chat to history:', (histRes as any).error);
          }
        }
        return; // Exit early - don't run fallback
      } else {
        // Fallback to legacy draftContent if nora-ai fails
        console.warn('[AssistantView] nora-ai failed, falling back to legacy draftContent:', response.error);
        const text = await draftContent(prompt, documentContent);
        setChatHistory(prev => [...prev, { role: 'model', text }]);
        setLoading(false); // Stop loading immediately
        // Persist assistant message (only if session id exists)
        if (sid) {
          void saveChatMessage(sid, 'assistant', text);
        }

        // Log to history ONCE per session with metadata link.
        if (sid && historySessionLoggedRef.current !== sid) {
          historySessionLoggedRef.current = sid;
          const histRes = await addToHistory(
            'DRAFT',
            String(t('assistantView.historyTitleDraft')),
            `Drafted content based on prompt: "${prompt.substring(0, 50)}..."`,
            { chat_session_id: sid }
          );
          if (!histRes.ok) {
            console.error('[AssistantView] Failed to write draft to history:', (histRes as any).error);
          }
        }
      }
    } catch (e: any) {
      const msg = e?.message || String(t('assistantView.errorChatFailed'));
      setChatHistory(prev => [...prev, { role: 'model', text: `Error: ${msg}` }]);
      setLoading(false);
      // Persist error text for debugging (still linked to the session)
      if (sid) {
        void saveChatMessage(sid, 'assistant', `Error: ${msg}`, { error: true });
      }
    }
  }, [documentContent, ensureSessionId, language, t]); // Re-create when documentContent or language changes

  // Register handler with parent and cleanup on unmount
  useEffect(() => {
    // NOTE: Parent expects the handler itself (msg => Promise<void>), not a function returning it.
    setExternalHandler(handleDraft);

    // Cleanup: unregister handler when component unmounts
    return () => {
      setExternalHandler(async (_msg: string) => {
        console.warn('AssistantView unmounted, handler no longer available');
      });
    };
  }, [handleDraft, setExternalHandler]);

  // Bubble loading state to parent for global UX (e.g., disable new chat button)
  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(loading);
    }
  }, [loading, onLoadingChange]);

  // Load existing messages when a session id is provided from History
  useEffect(() => {
    // If no session id passed, do nothing (default new chat screen)
    if (!initialSessionId) {
      // New chat flow: reset session state (the session will be created lazily on first message).
      setSessionId(null);
      historySessionLoggedRef.current = null;
      setChatHistory([]);
      return;
    }

    // History flow: lock the current session id and avoid writing a new history row for it.
    setSessionId(initialSessionId);
    historySessionLoggedRef.current = initialSessionId;

    let cancelled = false;
    // Mark as loading to show typing dots bubble for a consistent UX
    setLoading(true);
    (async () => {
      try {
        const messages = await fetchChatMessages(initialSessionId);
        if (cancelled) return;
        // Map storage roles to UI roles ('assistant'/'system' -> 'model')
        // Parse messages to extract file metadata if present
        const mapped = messages.map(m => {
          const { displayText, files } = parseMessageWithFiles(m.content);
          return {
            role: m.role === 'user' ? 'user' as const : 'model' as const,
            text: displayText,
            files: files.length > 0 ? files : undefined,
          };
        });
        setChatHistory(mapped);
      } catch (e) {
        if (!cancelled) {
          // Surface a minimal error message in the chat stream for visibility
          setChatHistory([{ role: 'model', text: String(t('assistantView.errorFailedToLoadConversation')) }]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialSessionId]);

  const handleImproveClick = async () => {
    if (!selection) return;
    setIsImproving(true);
    try {
      const result = await improveWriting(selection);
      setImprovementResult(result);
      setShowImprovementView(true);
      // Option 1: Do NOT save actions to history.
      // await addToHistory(
      //   'IMPROVE', 
      //   String(t('assistantView.historyTitleImprove')), 
      //   String(t('assistantView.historyDescriptionImprove')),
      //   { improvement: result }
      // );
    } catch (e) {
      alert(String(t('assistantView.errorFailedToImprove')));
    } finally {
      setIsImproving(false);
    }
  };

  const handleApplyImprovement = async () => {
    if (improvementResult && onReplace) {
      // Strategy: Use AI's diffMarkup to extract specific word changes.
      // Then, perform granular search-and-replace for Track Changes support.

      let applied = false;

      if (improvementResult.diffMarkup && onSearchAndReplaceInSelection) {
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
              await onSearchAndReplaceInSelection(original, modified);
            }
            applied = true;
          }
        } catch (e) {
          console.error("Granular replacement failed:", e);
        }
      }

      // Fallback: Replace full selection if no granular replacements applied
      if (!applied) {
        onReplace(improvementResult.rewrittenText);
      }

      setShowImprovementView(false);
      setImprovementResult(null);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const wordCount = selection ? selection.trim().split(/\s+/).length : 0;

  // Render Diff Markup
  const renderDiff = (markup: string) => {
    // Very basic parser for <remove>...</remove> and <add>...</add>
    // We split by tags and map
    const parts = markup.split(/(<remove>.*?<\/remove>|<add>.*?<\/add>)/g);
    return parts.map((part, i) => {
      if (part.startsWith('<remove>')) {
        return (
          <span key={i} className="line-through decoration-red-400 decoration-2 text-red-800/60 bg-red-50/80 px-1 rounded mx-0.5">
            {part.replace(/<\/?remove>/g, '')}
          </span>
        );
      } else if (part.startsWith('<add>')) {
        return (
          <span key={i} className="text-blue-600 font-medium bg-blue-50/80 px-1 rounded mx-0.5">
            {part.replace(/<\/?add>/g, '')}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // --- SUGGESTION VIEW MODE ---
  if (showImprovementView && improvementResult) {
    return (
      <div className="h-full flex flex-col bg-transparent">
        <div className="bg-white/40 backdrop-blur-md px-4 py-3 border-b border-white/30 flex justify-between items-center">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{String(t('assistantView.editSuggestions'))}</h2>
            <span className="text-xs text-slate-500">{String(t('assistantView.suggestionsAvailable')).replace('{0}', '1')}</span>
          </div>
          <button className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1">
            {String(t('assistantView.collapseAll'))} <ChevronUp size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-white/60 backdrop-blur-md rounded-xl shadow-sm border border-white/50 overflow-hidden">
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

            <div className="px-4 pb-4 pt-2">
              <div className="text-sm text-slate-700 mb-3 leading-relaxed">
                {String(t('assistantView.improvementExplanation'))}
              </div>

              {/* Diff Box */}
              <div className="bg-slate-50/50 rounded-lg p-3 text-sm font-serif leading-relaxed border border-slate-100/50 text-slate-600 mb-4">
                {renderDiff(improvementResult.diffMarkup)}
              </div>

              <div className="flex items-center gap-2">
                <button className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80 transition-colors">{String(t('assistantView.show'))}</button>
                <button
                  onClick={() => setShowImprovementView(false)}
                  className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80 transition-colors"
                >
                  {String(t('assistantView.dismiss'))}
                </button>
                <button
                  onClick={handleApplyImprovement}
                  className="flex-1 py-1.5 text-xs font-medium text-white bg-slate-900/90 border border-slate-900 rounded-lg hover:opacity-90 flex items-center justify-center gap-1 shadow-md"
                >
                  {String(t('assistantView.apply'))} <ChevronDown size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- DEFAULT CHAT VIEW ---
  return (
    <div className="h-full flex flex-col relative">
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20 scrollbar-hide">
        {chatHistory.length === 0 ? (
          <div className="mt-12 mb-12 text-center">
            <h1 className="font-serif text-3xl text-slate-800 mb-2 tracking-tight">{String(t('assistant.hello'))} {firstName},</h1>
            <h2 className="font-serif text-3xl text-slate-500 tracking-tight mb-12">{String(t('assistant.whatCanIDo'))}</h2>

            <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto">
              <button
                onClick={() => onNavigate(ViewState.ACTIONS)}
                className="flex flex-col items-start p-6 rounded-2xl border border-white/50 bg-white/60 backdrop-blur-sm shadow-sm hover:shadow-md hover:bg-white/70 transition-all text-left h-48 justify-between group"
              >
                <div className="p-3 rounded-full bg-green-100/70 text-green-700 group-hover:bg-green-200/80 transition-colors mb-4">
                  <FileText size={22} />
                </div>
                <div className="space-y-1.5">
                  <span className="font-bold text-slate-800 block text-sm">{String(t('assistant.skills'))}</span>
                  <span className="text-xs text-slate-500 leading-relaxed block">{String(t('assistant.skillsDescription'))}</span>
                </div>
              </button>

              <button
                onClick={() => onNavigate(ViewState.PLAYBOOKS)}
                className="flex flex-col items-start p-6 rounded-2xl border border-white/50 bg-white/60 backdrop-blur-sm shadow-sm hover:shadow-md hover:bg-white/70 transition-all text-left h-48 justify-between group"
              >
                <div className="p-3 rounded-full bg-orange-100/70 text-orange-700 group-hover:bg-orange-200/80 transition-colors mb-4">
                  <Folder size={22} />
                </div>
                <div className="space-y-1.5">
                  <span className="font-bold text-slate-800 block text-sm">{String(t('assistant.agents'))}</span>
                  <span className="text-xs text-slate-500 leading-relaxed block">{String(t('assistant.agentsDescription'))}</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] rounded-2xl p-4 text-sm leading-relaxed backdrop-blur-sm shadow-sm ${msg.role === 'user'
                  ? 'bg-slate-200/60 text-slate-900 rounded-tr-sm'
                  : 'bg-white/60 border border-white/50 text-slate-800 rounded-tl-sm'
                  }`}
              >
                {/* Display user message text (only if there's actual user text, not just file content) */}
                {msg.text && msg.text.trim().length > 0 && !msg.text.includes('--- Content from') && (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                )}

                {/* Display file attachments as icons (user request: anonymous/background) */}
                {msg.role === 'user' && msg.files && msg.files.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${msg.text && msg.text.trim().length > 0 ? 'mt-2' : ''}`}>
                    {msg.files.map((file, fileIdx) => (
                      <div
                        key={fileIdx}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100/80 rounded-lg border border-slate-200/60"
                      >
                        <FileText size={14} className="text-slate-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-slate-700 truncate max-w-[200px]">
                          {file.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.role === 'model' && !msg.text.startsWith('Error:') && (
                  <div className="mt-3 flex gap-2 border-t border-slate-200/50 pt-2">
                    <button
                      onClick={() => onInsert(msg.text)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded hover:bg-indigo-50/50 transition-colors"
                    >
                      {String(t('assistantView.insert'))}
                    </button>
                    <button
                      onClick={() => handleCopy(msg.text)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100/50 transition-colors"
                    >
                      {String(t('assistantView.copy'))}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/60 border border-white/50 rounded-2xl rounded-tl-sm p-4 shadow-sm backdrop-blur-sm">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING HIGHLIGHT BAR */}
      {selection && !showImprovementView && (
        <div className="absolute bottom-0 left-0 right-0 bg-blue-50/70 backdrop-blur-xl border-t border-blue-100/50 p-2 px-4 flex items-center justify-between z-20 animate-in slide-in-from-bottom-2 duration-200 shadow-lg">
          <span className="text-xs font-semibold text-slate-600">{String(t('assistantView.wordsHighlighted')).replace('{0}', String(wordCount))}</span>

          <div className="flex items-center gap-2">
            {/* Dropdown container for action selection */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowActionDropdown(!showActionDropdown)}
                disabled={isImproving}
                className="flex items-center gap-1.5 bg-white/80 border border-blue-200/60 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white hover:border-blue-300 transition-colors shadow-sm"
              >
                {isImproving ? (
                  <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"></span>
                ) : (
                  <Sparkles size={12} className="text-blue-500" />
                )}
                {String(t('assistantView.improveWriting'))}
                <ChevronDown size={12} className={`text-slate-400 transition-transform ${showActionDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown menu */}
              {showActionDropdown && (
                <div className="absolute bottom-full mb-1 right-0 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[160px] z-30 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <button
                    onClick={() => { handleImproveClick(); setShowActionDropdown(false); }}
                    disabled={isImproving}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 transition-colors"
                  >
                    <Sparkles size={14} className="text-blue-500" />
                    {String(t('assistantView.improveWriting'))}
                  </button>
                  <button
                    onClick={() => { onNavigate(ViewState.ACTIONS, 'ANONYMIZE'); setShowActionDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 transition-colors"
                  >
                    <Lock size={14} className="text-amber-500" />
                    {String(t('assistantView.anonymize'))}
                  </button>
                  <button
                    onClick={() => { onNavigate(ViewState.ACTIONS, 'TRANSLATE'); setShowActionDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 transition-colors"
                  >
                    <Globe size={14} className="text-green-500" />
                    {String(t('assistantView.translate'))}
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={onClearSelection}
              aria-label={String(t('assistantView.dismissHighlight'))}
              title={String(t('assistantView.dismissHighlight'))}
              className="p-1 hover:bg-blue-100/50 rounded text-slate-500 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
