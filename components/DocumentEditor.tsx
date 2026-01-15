import React, { useRef } from 'react';
import { Upload, Download } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { parseDocxText, saveBlob } from '../services/wordService';

interface DocumentEditorProps {
  content: string;
  onChange: (newContent: string) => void;
  onSelectionChange: (selection: string) => void;
  originalDocBuffer: ArrayBuffer | null;
  onLoadDocument: (buffer: ArrayBuffer) => void;
  originalDocName: string | null;
  onLoadDocumentName: (name: string) => void;
  onSaved: () => void;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({ 
  content, 
  onChange, 
  onSelectionChange,
  originalDocBuffer,
  onLoadDocument,
  originalDocName,
  onLoadDocumentName,
  onSaved
}) => {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelect = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const selectedText = textareaRef.current.value.substring(start, end);
      onSelectionChange(selectedText);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    onLoadDocumentName(file.name);

    const buffer = await file.arrayBuffer();
    onLoadDocument(buffer);

    try {
      const text = await parseDocxText(buffer);
      onChange(text);
    } catch (err) {
      console.error("Failed to parse docx", err);
      alert("Failed to parse document text.");
    }
  };

  const handleDownload = () => {
    if (originalDocBuffer) {
      const blob = new Blob([originalDocBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      saveBlob(blob, originalDocName || "Document.docx");
      onSaved();
    } else {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      saveBlob(blob, "Document.txt");
      onSaved();
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 p-2 md:p-8 overflow-hidden">
      <div className="bg-white shadow-xl h-full max-w-4xl mx-auto w-full flex flex-col border border-slate-200">
        <div className="bg-blue-600 text-white px-4 py-2 text-xs font-semibold flex justify-between items-center">
          <span>{String(t('documentEditor.simulatedWord'))}</span>
          <span className="text-white/90">
            {originalDocName || String(t('documentEditor.defaultFilename'))}
          </span>
          <div className="flex gap-2 items-center">
            <input
              type="file"
              accept=".docx"
              ref={fileInputRef}
              className="hidden"
              title="Open Document"
              aria-label="Open Document"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="hover:bg-blue-700 px-2 py-1 rounded flex items-center gap-1 transition-colors"
              title="Open Document"
            >
              <Upload size={14} /> Open
            </button>
            <button
              onClick={handleDownload}
              className="hover:bg-blue-700 px-2 py-1 rounded flex items-center gap-1 transition-colors"
              title="Download"
            >
              <Download size={14} /> Save
            </button>
          </div>
        </div>
        <div className="flex-1 p-4 md:p-8 overflow-hidden relative">
           <textarea
            ref={textareaRef}
            className="w-full h-full resize-none outline-none text-slate-800 font-serif leading-relaxed p-4 border-none focus:ring-0 text-lg"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onSelect={handleSelect}
            placeholder={String(t('documentEditor.placeholder'))}
            spellCheck={false}
          />
        </div>
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-1 text-[10px] text-slate-500 flex justify-end gap-4">
            <span>{String(t('documentEditor.pageIndicator'))}</span>
            <span>{String(t('documentEditor.languageIndicator'))}</span>
            <span>100%</span>
        </div>
      </div>
    </div>
  );
};
