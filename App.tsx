import React, { useState, useEffect, useRef } from 'react';
import { BottomNav } from './components/BottomNav';
import { Header } from './components/Header';
import { ChatInput } from './components/ChatInput';
import { AssistantView } from './views/AssistantView';
import { PlaybookView } from './views/PlaybookView';
import { ActionsView } from './views/ActionsView';
import { LoginView } from './views/LoginView';
import { HistoryView } from './views/HistoryView';
import { ViewState } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import type { HistoryItem } from './services/dataService';
import { useWordDocument } from './hooks/useWordDocument';

const AppContent: React.FC = () => {
  const { session, loading } = useAuth();
  const { t } = useLanguage();
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.ASSISTANT);

  // Use the Word document hook for all document operations
  const {
    documentContent,
    selection,
    isInWord,
    isLoading: wordLoading,
    error: wordError,
    insertAtEnd,
    replaceSelection,
    replaceDocument,
    replaceDocumentPreservingStyles,
    searchAndReplace,
    searchAndReplaceInSelection,
    clearSelection,
  } = useWordDocument();

  // State to hold the chat handler function from AssistantView
  const [assistantHandler, setAssistantHandler] = useState<((msg: string) => Promise<void>) | null>(null);

  // Key to force re-render of AssistantView to reset it
  const [chatSessionKey, setChatSessionKey] = useState(0);

  // Track handler readiness to guard sending and disable UI until available
  const handlerReady = typeof assistantHandler === 'function';

  // Message queue to handle chat messages when switching views (fixes race condition)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // Track assistant loading state to control UX (e.g., disable new chat during response)
  const [assistantLoading, setAssistantLoading] = useState(false);
  // Selected session id coming from History to preload a conversation in Assistant
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // Selected improvement result coming from History
  const [selectedImprovement, setSelectedImprovement] = useState<ImprovementResult | null>(null);
  // Pending action for ActionsView - set when navigating from AssistantView dropdown
  const [pendingAction, setPendingAction] = useState<'ANONYMIZE' | 'TRANSLATE' | null>(null);

  // Handler for inserting text into the Word document
  const handleInsertText = async (text: string) => {
    await insertAtEnd('\n\n' + text);
  };

  // Handler for updating selected text in the Word document
  const handleSelectionUpdate = async (newText: string) => {
    await replaceSelection(newText);
  };

  // Handler for updating the entire document
  const handleDocumentUpdate = async (newContent: string) => {
    await replaceDocument(newContent);
  };

  // Handler for updating the entire document preserving styles
  const handleDocumentUpdatePreservingStyles = async (newContent: string) => {
    await replaceDocumentPreservingStyles(newContent);
  };

  const handleChatSend = async (message: string) => {
    // If we are not in assistant view, switch to it and queue the message
    if (currentView !== ViewState.ASSISTANT) {
      setCurrentView(ViewState.ASSISTANT);
      setPendingMessage(message); // Store message to be sent after view mounts
      return;
    }

    // Send message immediately if already in assistant view
    if (handlerReady) {
      await assistantHandler!(message);
    } else {
      console.warn('Assistant handler not ready yet; queuing message');
      setPendingMessage(message);
    }
  };

  // Process pending message when assistant handler becomes available
  useEffect(() => {
    if (pendingMessage && assistantHandler && currentView === ViewState.ASSISTANT) {
      const sendPendingMessage = async () => {
        try {
          await assistantHandler(pendingMessage);
        } catch (error) {
          console.error('Error sending pending message:', error);
        } finally {
          setPendingMessage(null); // Clear pending message
        }
      };

      sendPendingMessage();
    }
  }, [pendingMessage, assistantHandler, currentView]);

  // Automatically switch back to Assistant view if resizing to desktop while in Document view
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && currentView === ViewState.DOCUMENT) {
        setCurrentView(ViewState.ASSISTANT);
      }
    };

    // Check on mount/update
    handleResize(mediaQuery);

    // Listen for changes
    mediaQuery.addEventListener('change', handleResize);
    return () => mediaQuery.removeEventListener('change', handleResize);
  }, [currentView]);

  const handleNewChat = () => {
    // Ensure we are in Assistant view
    setCurrentView(ViewState.ASSISTANT);
    // Clear any transient state that could leak into the new session
    setPendingMessage(null);
    setAssistantHandler(null);
    // Explicit decision: clear any previously selected session so Assistant mounts clean
    setSelectedSessionId(null);
    setSelectedImprovement(null);
    // Force remount of AssistantView to reset its internal state (e.g., chat history)
    setChatSessionKey(prev => prev + 1);
  };

  const handleHistory = () => {
    setCurrentView(ViewState.HISTORY);
  };

  // Handle click on a history item: navigate to Assistant and hydrate with session
  const handleOpenHistoryItem = (item: HistoryItem) => {
    const id = item?.metadata?.chat_session_id || null;
    const improvement = item?.metadata?.improvement || null;

    // Explicit per user request: history rows without a chat session id must not open Assistant,
    // because that results in a confusing empty "new chat" screen.
    if (!id && !improvement) return;

    setSelectedSessionId(id);
    setSelectedImprovement(improvement);
    setCurrentView(ViewState.ASSISTANT);
    // Force a remount when switching between different sessions to reload chat
    setChatSessionKey(prev => prev + 1);
  };

  // Navigation handler that supports optional action for ActionsView
  // Used by AssistantView dropdown to navigate directly to Anonymize/Translate
  const handleNavigate = (view: ViewState, action?: 'ANONYMIZE' | 'TRANSLATE' | null) => {
    if (view === ViewState.ACTIONS && action) {
      setPendingAction(action);
    } else {
      setPendingAction(null);
    }
    setCurrentView(view);
  };

  const renderView = () => {
    switch (currentView) {
      case ViewState.ASSISTANT:
        return (
          <AssistantView
            key={`${chatSessionKey}:${selectedSessionId ?? 'new'}`}
            documentContent={documentContent}
            selection={selection}
            onInsert={handleInsertText}
            onReplace={handleSelectionUpdate}
            onSearchAndReplaceInSelection={searchAndReplaceInSelection}
            /**
             * IMPORTANT (bug fix)
             * We cannot pass the raw React state setter `setAssistantHandler` directly because
             * React treats a function argument as an "updater" (prev => next). Since the
             * handler itself is a function, passing it directly would invoke updater semantics
             * and can accidentally store a Promise or other invalid value.
             */
            setExternalHandler={(handler) => setAssistantHandler(() => handler)}
            onLoadingChange={setAssistantLoading}
            onNavigate={handleNavigate}
            onClearSelection={clearSelection}
            initialSessionId={selectedSessionId ?? undefined}
            initialImprovement={selectedImprovement}
          />
        );
      case ViewState.ACTIONS:
        return (
          <ActionsView
            documentContent={documentContent}
            selection={selection}
            onUpdateDocument={handleDocumentUpdate}
            onUpdateDocumentPreservingStyles={handleDocumentUpdatePreservingStyles}
            onUpdateSelection={handleSelectionUpdate}
            onSearchAndReplace={searchAndReplace}
            onSearchAndReplaceInSelection={searchAndReplaceInSelection}
            initialAction={pendingAction}
            // Note: originalDocBuffer is no longer needed since we work directly with Word
            originalDocBuffer={null}
            onUpdateOriginalDocBuffer={() => {
              // No-op: In Word add-in mode, we don't manage the document buffer ourselves
            }}
          />
        );
      case ViewState.PLAYBOOKS:
        return (
          <PlaybookView
            documentContent={documentContent}
            onUpdateDocument={handleDocumentUpdate}
          />
        );
      case ViewState.HISTORY:
        return <HistoryView onOpenItem={handleOpenHistoryItem} />;
      case ViewState.PROMPT_LIBRARY:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
            <div className="bg-white/50 backdrop-blur-sm p-4 rounded-full mb-4 shadow-sm border border-white/40">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <h3 className="text-slate-800 font-semibold">{String(t('promptLibrary.title'))}</h3>
            <p className="text-xs mt-2">{String(t('promptLibrary.description'))}</p>
          </div>
        );
      case ViewState.DOCUMENT:
        return (
          <DocumentEditor
            content={documentContent}
            onChange={setDocumentContent}
            onSelectionChange={setCurrentSelection}
          />
        );
      default:
        return null;
    }
  };

  // Show error if not running in Word
  if (!loading && !wordLoading && !isInWord && wordError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center border border-slate-200">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Word Add-in Required</h2>
          <p className="text-slate-600 mb-4">
            Nora Legal works as a Microsoft Word Add-in. Please open this application from within Microsoft Word.
          </p>
          <div className="bg-slate-50 rounded-lg p-4 text-left text-sm text-slate-600">
            <p className="font-medium mb-2">How to use:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Open Microsoft Word</li>
              <li>Go to Insert → Add-ins</li>
              <li>Find and add "Nora Legal"</li>
              <li>Click "Open Nora" in the ribbon</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#eef2f6]">
      {/* Full-width Task Pane - No left document editor panel */}
      <div className="w-full flex flex-col h-full z-10 relative overflow-hidden">
        {/* Glass Background Elements */}
        <div className="absolute top-[-10%] right-[-10%] w-[300px] h-[300px] bg-purple-300/30 rounded-full blur-[80px] pointer-events-none"></div>
        <div className="absolute bottom-[10%] left-[-10%] w-[250px] h-[250px] bg-blue-300/30 rounded-full blur-[80px] pointer-events-none"></div>

        {/* Main Glass Container */}
        <div className="relative flex flex-col h-full bg-white/70 backdrop-blur-xl border-l border-white/40 shadow-2xl">
          {loading || wordLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin text-indigo-600">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
          ) : !session ? (
            <LoginView />
          ) : (
            <>
              <Header onNewChat={handleNewChat} onHistory={handleHistory} disableNewChat={assistantLoading} />
              <div className="flex-1 overflow-hidden relative flex flex-col">
                {renderView()}
              </div>
              {currentView === ViewState.ASSISTANT && (
                <ChatInput onSend={handleChatSend} isLoading={assistantLoading || !handlerReady} />
              )}
              <BottomNav currentView={currentView} onViewChange={setCurrentView} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      {/* LanguageProvider added per user request to enable UI language switching on Login */}
      <LanguageProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
};

export default App;