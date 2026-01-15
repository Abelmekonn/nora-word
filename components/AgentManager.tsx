import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Agent } from '../types';
import { createAgent, listAgents, softDeleteAgent, updateAgent } from '../services/agentService';
import { sanitizeInput, validateRequired } from '../utils/validation';
import { PLAYBOOKS } from '../constants';
import { useLanguage } from '../context/LanguageContext';

/**
 * AgentManager (modal)
 *
 * Explicitly requested by the user (plan):
 * - Provide a UI to create/edit/save Agents to Supabase.
 *
 * Assistant decisions (explained):
 * - Implemented as a full-screen modal for simplicity and consistency with current minimal UI.
 * - Rules are edited as one-per-line text to provide a compact authoring experience. We convert
 *   to/from string[] when saving/loading.
 * - "Tools" are stored as arbitrary JSON; a textarea allows power users to supply JSON arrays.
 * 
 * UI Fix (user requested):
 * - Fixed agent list display to show proper cards with name/description instead of "New Agent" buttons
 * - Fixed form visibility logic (was inverted)
 * - Added back button for navigation from form view to list view
 * - Restructured layout to match provided screenshots
 */
interface AgentManagerProps {
  onClose: () => void;
  onSaved?: () => void; // called after successful create/update/delete so parent can refresh
  initialView?: 'list' | 'form'; // Explicitly requested to skip list view
}

export const AgentManager: React.FC<AgentManagerProps> = ({ onClose, onSaved, initialView = 'list' }) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState<boolean>(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(initialView === 'form');
  // Track if we have ever shown the list view. Used to determine backward navigation behavior.
  const [hasShownList, setHasShownList] = useState<boolean>(initialView === 'list');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Message state for user feedback (replaces window.alert which is not supported in Office.js)
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  // Reset scroll when view changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [showForm, selectedId]);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState(''); // rules, one per line
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [toolsText, setToolsText] = useState('[]'); // raw JSON text for tools

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // User request: guard initial fetch and fallback to PLAYBOOKS on error
        const data = await listAgents();
        setAgents(data);
        // Assistant decision: Don't auto-select the first agent to show list view initially
      } catch (_e) {
        // Assistant decision: local conversion to avoid service coupling; mirrors agentService conversion
        const fallback: Agent[] = PLAYBOOKS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          rules: Array.isArray(p.rules) ? p.rules : [],
          systemPrompt: undefined,
          model: 'gpt-4o',
          tools: [],
        }));
        setAgents(fallback);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // When selection changes, load form
  useEffect(() => {
    if (!selectedId) {
      setName('');
      setDescription('');
      setRulesText('');
      setSystemPrompt('');
      setModel('gpt-4o');
      setToolsText('[]');
      return;
    }
    const a = agents.find((x) => x.id === selectedId);
    if (!a) return;
    setName(a.name || '');
    setDescription(a.description || '');
    setRulesText((a.rules || []).join('\n'));
    setSystemPrompt(a.systemPrompt || '');
    setModel(a.model || 'gpt-4o');
    setToolsText(JSON.stringify(a.tools ?? [], null, 2));
  }, [selectedId, agents]);

  const parsedRules = useMemo(
    () =>
      rulesText
        .split('\n')
        .map((r) => sanitizeInput(r, 1000).trim())
        .filter((r) => r.length > 0),
    [rulesText]
  );

  function tryParseTools(): any[] | null {
    const raw = toolsText.trim();
    if (raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  }

  // User action: Create a new agent (navigates to empty form)
  function handleCreateNew() {
    setSelectedId(null);
    setName('');
    setDescription('');
    setRulesText('');
    setSystemPrompt('');
    setModel('gpt-4o');
    setToolsText('[]');
    setShowForm(true);
  }

  // User action: Select an existing agent to edit
  function handleSelectAgent(id: string) {
    setSelectedId(id);
    setShowForm(true);
  }

  // User action: Go back from form view to list view
  function handleBack() {
    // If we started in 'form' mode (e.g. "New Agent" from empty state) and haven't transitioned to the list yet,
    // clicking Back should exit the manager entirely rather than showing an empty list.
    if (!hasShownList) {
      onClose();
      return;
    }
    setShowForm(false);
    setSelectedId(null);
  }

  function isUuid(id: string | null): boolean {
    return !!id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
  }

  async function handleSave() {
    setMessage(null); // Clear previous messages
    if (selectedId && !isUuid(selectedId)) {
      setMessage({ type: 'error', text: String(t('agentManager.cannotEditFallback')) });
      return;
    }
    try {
      const safeName = validateRequired(sanitizeInput(name, 200), 'Name');
      const tools = tryParseTools();
      if (tools === null) {
        setMessage({ type: 'error', text: String(t('agentManager.toolsInvalidJson')) });
        return;
      }

      setLoading(true);
      if (selectedId) {
        const updated = await updateAgent(selectedId, {
          name: safeName,
          description: sanitizeInput(description, 2000),
          rules: parsedRules,
          systemPrompt: sanitizeInput(systemPrompt, 10000),
          model: sanitizeInput(model, 200),
          tools,
        });
        if (!updated) {
          setMessage({ type: 'error', text: String(t('agentManager.failedToUpdate')) });
        } else {
          const refreshed = await listAgents();
          setAgents(refreshed);
          setMessage({ type: 'success', text: String(t('agentManager.updateSuccess')) });
          setSelectedId(null);
          setShowForm(false);
          setHasShownList(true);
          onSaved?.();
          // Auto-clear success message after 3 seconds
          setTimeout(() => setMessage(null), 3000);
        }
      } else {
        const created = await createAgent({
          name: safeName,
          description: sanitizeInput(description, 2000),
          rules: parsedRules,
          systemPrompt: sanitizeInput(systemPrompt, 10000),
          model: sanitizeInput(model, 200),
          tools,
        });
        if (!created) {
          setMessage({ type: 'error', text: String(t('agentManager.failedToCreate')) });
        } else {
          const refreshed = await listAgents();
          setAgents(refreshed);
          setMessage({ type: 'success', text: String(t('agentManager.createSuccess')) });
          setSelectedId(null);
          setShowForm(false);
          setHasShownList(true);
          onSaved?.();
          // Auto-clear success message after 3 seconds
          setTimeout(() => setMessage(null), 3000);
        }
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || String(t('agentManager.validationFailed')) });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setMessage(null); // Clear previous messages
    if (!selectedId) return;
    if (!isUuid(selectedId)) {
      setMessage({ type: 'error', text: String(t('agentManager.failedToDelete')) });
      return;
    }
    // Note: confirm() is not supported in Office.js, so we proceed with delete
    // User can cancel by not clicking delete button
    setLoading(true);
    try {
      const ok = await softDeleteAgent(selectedId);
      if (!ok) {
        setMessage({ type: 'error', text: String(t('agentManager.failedToDelete')) });
        return;
      }
      const refreshed = await listAgents();
      setAgents(refreshed);
      setMessage({ type: 'success', text: String(t('agentManager.deleteSuccess')) });
      setSelectedId(null);
      setShowForm(false);
      setHasShownList(true);
      onSaved?.();
      // Auto-clear success message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setLoading(false);
    }
  }

  setTimeout(() => setMessage(null), 30000);

  // Determine the form title: "New Agent" for creating, or the agent's name when editing
  const formTitle = selectedId
    ? agents.find((a) => a.id === selectedId)?.name || String(t('agentManager.untitledAgent'))
    : String(t('agentManager.newAgent'));

  // Assistant decision: List is always shown inline. The FORM is a modal.
  return (
    <div className="h-full flex flex-col bg-white/60 backdrop-blur-md relative">
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* LIST VIEW - Always rendered unless we are in implicit create mode via props */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-1.5 -ml-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title={String(t('agentManager.backToAnalysis'))}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-base font-bold text-slate-800">{String(t('agentManager.title'))}</div>
            </div>
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {String(t('agentManager.newAgent'))}
            </button>
          </div>

          {loading && !showForm && (
            <div className="text-sm text-slate-500 py-4 text-center">
              {String(t('agentManager.loading'))}
            </div>
          )}

          {!loading && agents.length === 0 && (
            <div className="text-sm text-slate-500 py-8 text-center">
              {String(t('agentManager.noAgentsYet'))}
            </div>
          )}

          {!loading && agents.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent.id)}
                  className={`text-left p-4 rounded-xl border transition-all hover:shadow-md ${selectedId === agent.id
                    ? 'border-slate-400 bg-slate-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                >
                  <div className="font-medium text-sm text-slate-800 mb-1 line-clamp-1">
                    {agent.name || String(t('agentManager.untitledAgent'))}
                  </div>
                  <div className="text-xs text-slate-500 line-clamp-2">
                    {agent.description || String(t('agentManager.noDescription'))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* FORM MODAL - Overlays the list view when showForm is true */}
      {showForm && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full h-full max-h-full rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBack}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {String(t('agentManager.back'))}
                </button>
                <div className="font-semibold text-slate-800 text-sm">
                  {formTitle}
                </div>
              </div>
              {/* Optional: Add a close (X) button if desired, though 'Back' serves this purpose */}
            </div>

            {/* Message display inside modal */}
            {message && (
              <div className={`px-4 py-2 text-xs border-b ${message.type === 'error'
                ? 'bg-red-50 text-red-700 border-red-100'
                : 'bg-green-50 text-green-700 border-green-100'
                }`}>
                {message.text}
              </div>
            )}

            {/* Scrollable Form Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    {String(t('agentManager.nameLabel'))} *
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 outline-none"
                    placeholder={String(t('agentManager.namePlaceholder'))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {String(t('agentManager.descriptionLabel'))}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 outline-none resize-none"
                  placeholder={String(t('agentManager.descriptionPlaceholder'))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {String(t('agentManager.rulesLabel'))}
                </label>
                <textarea
                  value={rulesText}
                  onChange={(e) => setRulesText(e.target.value)}
                  rows={3}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 font-mono focus:border-slate-500 focus:ring-2 focus:ring-slate-200 outline-none resize-none"
                  placeholder={String(t('agentManager.rulesPlaceholder'))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {String(t('agentManager.systemPromptLabel'))}
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 font-mono focus:border-slate-500 focus:ring-2 focus:ring-slate-200 outline-none resize-none"
                  placeholder={String(t('agentManager.systemPromptPlaceholder'))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {String(t('agentManager.toolsLabel'))}
                </label>
                <textarea
                  value={toolsText}
                  onChange={(e) => setToolsText(e.target.value)}
                  rows={2}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 font-mono focus:border-slate-500 focus:ring-2 focus:ring-slate-200 outline-none resize-none"
                  placeholder={String(t('agentManager.toolsPlaceholder'))}
                />
              </div>
            </div>

            {/* Modal Footer (Actions) */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-lg text-white bg-slate-800 hover:bg-slate-900 text-sm font-medium disabled:opacity-50 transition-colors shadow-sm"
              >
                {selectedId ? String(t('agentManager.saveChanges')) : String(t('agentManager.createAgent'))}
              </button>
              {selectedId && (
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-lg text-red-600 bg-white border border-red-200 hover:bg-red-50 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {String(t('agentManager.delete'))}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
