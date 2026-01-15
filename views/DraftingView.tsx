import React, { useState } from 'react';
import { draftContent } from '../services/aiService';
import { Button } from '../components/Button';
import { PenTool, Copy, Check } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface DraftingViewProps {
  documentContent: string;
  onInsert: (text: string) => void;
}

export const DraftingView: React.FC<DraftingViewProps> = ({ documentContent, onInsert }) => {
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDraft = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setCopied(false);
    try {
      const text = await draftContent(prompt, documentContent);
      setResult(text);
    } catch (e) {
      alert(String(t('draftingView.errorFailedToDraft')));
    } finally {
      setLoading(false);
    }
  };

  const handleInsert = () => {
    onInsert(result);
    setResult('');
    setPrompt('');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">{String(t('draftingView.title'))}</h2>
        <p className="text-sm text-slate-500">{String(t('draftingView.description'))}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase text-slate-500">{String(t('draftingView.promptLabel'))}</label>
        <textarea
          className="w-full h-32 p-3 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
          placeholder={String(t('draftingView.placeholder'))}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={handleDraft} isLoading={loading} disabled={!prompt.trim()} className="w-full">
            <PenTool className="w-4 h-4 mr-2" />
            Generate Draft
          </Button>
        </div>
      </div>

      {result && (
        <div className="flex-1 flex flex-col border border-slate-200 rounded-md bg-white shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-50 p-2 border-b border-slate-200 flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-600">{String(t('draftingView.generatedOutput'))}</span>
            <button onClick={handleCopy} className="text-slate-500 hover:text-slate-700 transition-colors">
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
          </div>
          <div className="p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap overflow-y-auto flex-1 max-h-64">
            {result}
          </div>
          <div className="p-3 border-t border-slate-100">
            <Button onClick={handleInsert} variant="secondary" className="w-full">
              Insert into Document
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
