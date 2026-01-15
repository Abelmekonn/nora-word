
import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { fetchHistory, HistoryItem } from '../services/dataService';
import { formatDistanceToNow } from 'date-fns'; // We'll simulate this if date-fns isn't available or just use raw js
import { useLanguage } from '../context/LanguageContext';

/**
 * HistoryView
 * Explicit per user request: clicking a history item should open the chat history
 * in the Assistant tab. To support that, we accept an optional onOpenItem callback.
 * Reasoning (assistant's decision): keep this component presentational and emit
 * the selected item upward; parent decides navigation and loading strategy.
 */
export const HistoryView: React.FC<{ onOpenItem?: (item: HistoryItem) => void }> = ({ onOpenItem }) => {
  const { t } = useLanguage();
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    console.log('🔄 Loading history...');
    setLoading(true);
    setHistoryItems([]); // Clear immediately for visual feedback
    try {
      const data = await fetchHistory();
      console.log('✅ History loaded:', data.length, 'items');
      setHistoryItems(data);
    } catch (err) {
      console.error('❌ Failed to load history:', err);
    } finally {
      console.log('🏁 Loading complete');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const formatTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (diffInSeconds < 60) return String(t('history.justNow'));
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} ${String(t('history.minsAgo'))}`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ${String(t('history.hoursAgo'))}`;
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
  };

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="px-4 py-3 border-b border-white/30 flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-slate-500" />
          <h2 className="text-lg font-bold text-slate-800">{String(t('history.title'))}</h2>
        </div>
        <button onClick={loadHistory} className="p-1 hover:bg-white/40 rounded-full transition-colors">
          <RefreshCw size={14} className={`text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Loading state - shows during initial load and refresh */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="animate-spin text-indigo-600">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <p className="text-slate-500 text-xs mt-2">{String(t('history.loading'))}</p>
          </div>
        )}

        {/* Empty state - only show when NOT loading */}
        {!loading && historyItems.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-10">
            {String(t('history.emptyState'))}
          </div>
        )}

        {/* History items - only show when NOT loading */}
        {!loading && historyItems.map((item) => {
          // Explicit per user request: history items without a chat session id must be unclickable.
          // Reasoning (assistant's decision): prevents navigating to Assistant and showing an empty chat.
          const hasChatSessionId = Boolean(item?.metadata?.chat_session_id);
          const hasImprovement = Boolean(item?.metadata?.improvement);
          // Option 3: All actions are now logged as chats, so they will have chat_session_id.
          // We keep hasImprovement for backward compatibility or if improveWriting is used outside ActionsView.
          const isClickable = hasChatSessionId || hasImprovement;

          return (
            <div
              key={item.id}
              onClick={isClickable ? () => onOpenItem?.(item) : undefined}
              aria-disabled={!isClickable}
              className={[
                "p-3 rounded-xl border border-white/40 bg-white/40 backdrop-blur-sm transition-all group shadow-sm",
                // Explicit per user request: do NOT show a "disabled" cursor/style; just make it unclickable.
                isClickable ? "hover:bg-white/60 cursor-pointer" : "",
              ].join(" ")}
            >
            <div className="flex justify-between items-start mb-1">
              <h3 className="text-sm font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{item.title}</h3>
              <span className="text-[10px] text-slate-400">{formatTime(item.created_at)}</span>
            </div>
            <p className="text-xs text-slate-500 line-clamp-2">{item.description}</p>
            </div>
          );
        })}
        
        {/* "View older" button - only show when NOT loading and has items */}
        {!loading && historyItems.length > 0 && (
          <div className="pt-4 text-center">
              <button className="text-xs text-slate-400 hover:text-slate-600">{String(t('history.viewOlder'))}</button>
          </div>
        )}
      </div>
    </div>
  );
};
