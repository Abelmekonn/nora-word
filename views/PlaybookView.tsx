
import React, { useState, useEffect } from 'react';
import { RedlineSuggestion, Agent } from '../types';
import { listAgents } from '../services/agentService';
import { AgentManager } from '../components/AgentManager';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { escapeRegex } from '../utils/validation';
import { runAgentAnalysis } from '../services/aiService';
import { addToHistory } from '../services/dataService';
import { PLAYBOOKS } from '../constants';
import { useLanguage } from '../context/LanguageContext';

interface PlaybookViewProps {
  documentContent: string;
  onUpdateDocument: (content: string) => void | Promise<void>;
}

export const PlaybookView: React.FC<PlaybookViewProps> = ({ documentContent, onUpdateDocument }) => {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [suggestions, setSuggestions] = useState<RedlineSuggestion[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(0);

  // 'ANALYSIS' = default view, 'MANAGE_LIST' = list agents inline, 'MANAGE_CREATE' = create/edit form inline
  const [viewMode, setViewMode] = useState<'ANALYSIS' | 'MANAGE_LIST' | 'MANAGE_CREATE'>('ANALYSIS');

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    /**
     * withTimeout helper
     * Assistant decision: Added to ensure the UI never hangs indefinitely on slow networks.
     * If listAgents() takes longer than the threshold, we gracefully fall back to local PLAYBOOKS.
     */
    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise
          .then((val) => {
            clearTimeout(timer);
            resolve(val);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    }

    /**
     * map playbooks -> agents
     * Assistant decision: Local mapping to avoid importing service internals. Mirrors agentService conversion.
     */
    const toAgentsFromPlaybooks = (): Agent[] =>
      PLAYBOOKS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        rules: Array.isArray(p.rules) ? p.rules : [],
        systemPrompt: undefined,
        model: 'gpt-4o',
        tools: [],
      }));

    const loadAgents = async () => {
      setLoadingAgents(true);
      try {
        // User request: make agent loading resilient with timeout + fallback
        const data = await withTimeout(listAgents(), 6000);
        setAgents(data);
        if (data.length > 0) {
          setSelectedAgentId(data[0].id);
        }
      } catch (_e) {
        // Fallback to built-in PLAYBOOKS to keep the UI usable
        const fallback = toAgentsFromPlaybooks();
        setAgents(fallback);
        if (fallback.length > 0) {
          setSelectedAgentId(fallback[0].id);
        }
      } finally {
        setLoadingAgents(false);
      }
    };
    loadAgents();
  }, []);

  const handleApply = (suggestion: RedlineSuggestion, idx: number) => {
    // Simple replacement strategy
    if (suggestion.originalText === 'ENTIRE DOCUMENT') {
      // Append if it's a missing clause type of suggestion
      onUpdateDocument(documentContent + "\n\n" + suggestion.suggestedText);
    } else {
      // Use replaceAll to replace ALL occurrences (not just first)
      // Escape regex special characters to prevent regex injection
      const escapedOriginal = escapeRegex(suggestion.originalText);
      const regex = new RegExp(escapedOriginal, 'g');
      const newContent = documentContent.replace(regex, suggestion.suggestedText);
      onUpdateDocument(newContent);
    }
    // Remove suggestion from list
    handleDismiss(idx);
  };

  const handleDismiss = (idx: number) => {
    const newSuggestions = [...suggestions];
    newSuggestions.splice(idx, 1);
    setSuggestions(newSuggestions);
    setExpandedId(null);
  };

  const handleApplyAll = () => {
    let currentContent = documentContent;
    suggestions.forEach(suggestion => {
      if (suggestion.originalText === 'ENTIRE DOCUMENT') {
        currentContent += "\n\n" + suggestion.suggestedText;
      } else {
        // Use replaceAll to replace ALL occurrences (not just first)
        // Escape regex special characters to prevent regex injection
        const escapedOriginal = escapeRegex(suggestion.originalText);
        const regex = new RegExp(escapedOriginal, 'g');
        currentContent = currentContent.replace(regex, suggestion.suggestedText);
      }
    });
    onUpdateDocument(currentContent);
    setSuggestions([]);
  };

  // If in management mode, render the AgentManager INLINE (no modal)
  if (viewMode !== 'ANALYSIS') {
    return (
      <AgentManager
        initialView={viewMode === 'MANAGE_CREATE' ? 'form' : 'list'}
        onClose={() => setViewMode('ANALYSIS')}
        onSaved={async () => {
          // Refresh agents after CRUD and go back to analysis
          // We stay in management view briefly to show success, but the component handles its own internal state.
          // Ideally, we want to reload the agent list for the dropdown.
          setLoadingAgents(true);
          try {
            const data = await listAgents();
            setAgents(data);
            if (data.length > 0 && !data.find(a => a.id === selectedAgentId)) {
              setSelectedAgentId(data[0].id);
            }
          } catch (e) { console.error(e); }
          setLoadingAgents(false);
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-transparent">

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingAgents && (
          <div className="text-center py-10 text-slate-500 text-sm">
            {String(t('playbook.loadingAgents'))}
          </div>
        )}

        {!loadingAgents && suggestions.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-sm">
            {agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center space-y-4" >
                <button
                  onClick={() => setViewMode('MANAGE_CREATE')}
                  className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors mx-auto"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {String(t('agentManager.newAgent'))}
                </button>
                <div className="text-sm text-slate-500 mb-4">{String(t('playbook.noAgentsFound'))}</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-slate-600">{String(t('playbook.selectAgent'))}</div>
                  <button
                    onClick={() => setViewMode('MANAGE_LIST')}
                    className="text-xs font-semibold bg-white/60 border border-white/50 px-3 py-1.5 rounded-lg hover:bg-white/80 text-slate-700 shadow-sm transition-all"
                  >
                    {String(t('playbook.manageAgents'))}
                  </button>
                </div>
                {String(t('playbook.selectAgentInstructions'))}

                {/* Custom Styling Dropdown */}
                <div className="relative mt-4">
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    disabled={agents.length === 0}
                    className="w-full text-left p-3 text-sm bg-white/70 backdrop-blur-sm border border-white/60 rounded-xl shadow-sm hover:bg-white/90 hover:shadow-md transition-all flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-700">
                      {agents.find(a => a.id === selectedAgentId)?.name || String(t('playbook.selectAgent'))}
                    </span>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {dropdownOpen && (
                    <div className="absolute z-50 w-full mt-2 bg-white/90 backdrop-blur-xl border border-white/50 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
                        {agents.map(a => (
                          <button
                            key={a.id}
                            onClick={() => {
                              setSelectedAgentId(a.id);
                              setDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between group ${selectedAgentId === a.id
                              ? 'bg-indigo-50 text-indigo-700 font-medium'
                              : 'text-slate-600 hover:bg-slate-100'
                              }`}
                          >
                            <span>{a.name}</span>
                            {selectedAgentId === a.id && (
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Backdrop to close dropdown when clicking outside */}
                  {dropdownOpen && (
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setDropdownOpen(false)}
                    ></div>
                  )}
                </div>
                <div className="mt-4">
                  <button
                    onClick={async () => {
                      if (!selectedAgentId) return;
                      setLoading(true);
                      setSuggestions([]);
                      try {
                        const agent = agents.find(a => a.id === selectedAgentId)!;
                        const results = await runAgentAnalysis(documentContent, agent);
                        setSuggestions(results);
                        if (results.length > 0) setExpandedId(0);
                        // await addToHistory('PLAYBOOK', String(t('playbookView.historyAgentAnalysis')).replace('{0}', agent.name), String(t('playbookView.historyAgentAnalysisDescription')).replace('{0}', agent.name));
                      } catch (e) {
                        alert(String(t('playbook.analysisFailed')));
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading || agents.length === 0}
                    className="text-xs font-semibold bg-white/60 border border-white/50 px-3 py-1.5 rounded-lg hover:bg-white/80 text-slate-700 shadow-sm transition-all disabled:opacity-50"
                  >
                    {loading ? String(t('playbook.checking')) : String(t('playbook.checkDocument'))}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {suggestions.map((suggestion, idx) => {
          const isExpanded = expandedId === idx;
          return (
            <div key={idx} className="bg-white/60 backdrop-blur-md rounded-xl shadow-sm border border-white/50 overflow-hidden transition-all duration-300">
              <button
                onClick={() => setExpandedId(isExpanded ? null : idx)}
                className="w-full text-left p-4 flex items-start gap-3 hover:bg-white/40 transition-colors"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded bg-green-200/80 text-green-900 flex items-center justify-center text-xs font-bold">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-800 leading-tight pr-4">{suggestion.reason}</h3>
                </div>
                {isExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="text-sm text-slate-700 mb-3 leading-relaxed">
                    {String(t('playbook.detectedViolation')).replace('{0}', suggestion.severity.toUpperCase())}
                  </div>

                  {/* Redline Display */}
                  <div className="bg-slate-50/50 rounded-lg p-3 text-sm font-serif leading-relaxed border border-white/50 text-slate-500 mb-4">
                    <span className="line-through decoration-red-400 decoration-2 text-red-800/60 bg-red-50/50 px-1 rounded block mb-1">
                      {suggestion.originalText.substring(0, 100)}{suggestion.originalText.length > 100 ? '...' : ''}
                    </span>
                    <span className="text-blue-600 font-medium bg-blue-50/50 px-1 rounded block">
                      {suggestion.suggestedText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <button className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80">{String(t('playbook.show'))}</button>
                    <button
                      onClick={() => handleDismiss(idx)}
                      className="flex-1 py-1.5 text-xs font-medium text-slate-600 bg-white/60 border border-white/50 rounded-lg hover:bg-white/80"
                    >
                      {String(t('playbook.dismiss'))}
                    </button>
                    <button
                      onClick={() => handleApply(suggestion, idx)}
                      className="flex-1 py-1.5 text-xs font-medium text-white bg-slate-900/90 border border-slate-900 rounded-lg hover:opacity-90 flex items-center justify-center gap-1 shadow-md"
                    >
                      {String(t('playbook.apply'))} <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {suggestions.length > 0 && (
        <div className="p-4 bg-white/40 backdrop-blur-md border-t border-white/30 sticky bottom-0">
          <div className="flex gap-3">
            <button
              onClick={() => setSuggestions([])}
              className="flex-1 py-2.5 rounded-xl bg-slate-100/70 text-slate-600 text-sm font-medium hover:bg-slate-200/70 transition-colors"
            >
              {String(t('playbook.dismissAll'))}
            </button>
            <button
              onClick={handleApplyAll}
              className="flex-[2] py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-slate-300/50"
            >
              {String(t('playbook.applyAll'))} <ChevronDown size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
