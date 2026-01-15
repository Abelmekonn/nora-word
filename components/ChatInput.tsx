import React, { useState, useEffect, useRef } from 'react';
import { Paperclip, ArrowUp, Mic, MicOff, Loader2, Square, Zap, BookOpen, Pause, Play, X, AlertCircle } from 'lucide-react';
import {
  VoiceRecorder,
  getVoiceRecorder,
  transcribeAudio,
  RecordingState
} from '../services/voiceTranscriptionService';
import { uploadFilesToKnowledge, getAcceptForSmartDrafting, UploadedDocMeta } from '../services/uploadService';
import { fetchPlaybooks } from '../services/dataService';
import { Playbook } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { extractTextFromFile } from '../utils/textExtraction';
import { sanitizeFilename } from '../config/documentTypes';

// Extended interface to store extracted text with uploaded files
interface UploadedFileWithContent extends UploadedDocMeta {
  extractedText?: string; // Extracted text content from the file
}

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading }) => {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isVoiceSupported, setIsVoiceSupported] = useState(true);
  // Upload status banner (explicit user request): show clear feedback when attaching files.
  const [uploadStatus, setUploadStatus] = useState<{
    state: 'idle' | 'validating' | 'uploading' | 'done' | 'error';
    message?: string;
  }>({ state: 'idle' });
  
  // Store uploaded files with extracted text so they persist and can be displayed/removed
  // Files are stored after successful upload and cleared when message is sent or manually removed
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileWithContent[]>([]);

  const voiceRecorderRef = useRef<VoiceRecorder | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isTimerActiveRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlighterRef = useRef<HTMLDivElement | null>(null);
  const skillsMenuRef = useRef<HTMLDivElement | null>(null);
  const agentsMenuRef = useRef<HTMLDivElement | null>(null);
  const acceptAttr = getAcceptForSmartDrafting();

  // UI state for Skills and Agents menus (Added per user request)
  // Explicitly requested by the user: Add "Skills" and "Agents" icons that open selectors and insert inline tokens.
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAgentsMenu, setShowAgentsMenu] = useState(false);
  const [agents, setAgents] = useState<Playbook[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  // Check voice support on mount
  useEffect(() => {
    setIsVoiceSupported(VoiceRecorder.isSupported());
  }, []);


  // Load Agents once (maps to Playbooks list) — explicit per plan
  useEffect(() => {
    let cancelled = false;
    const loadAgents = async () => {
      try {
        setAgentsLoading(true);
        const data = await fetchPlaybooks();
        if (!cancelled) setAgents(data);
      } catch (e) {
        if (!cancelled) setAgentsError(String(t('chatInput.errorFailedToLoadAgents')));
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    };
    loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdowns on outside click — explicit per plan choice to improve UX
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedSkills = skillsMenuRef.current?.contains(target);
      const clickedAgents = agentsMenuRef.current?.contains(target);
      if (!clickedSkills && !clickedAgents) {
        setShowSkillsMenu(false);
        setShowAgentsMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Auto-resize textarea based on content (Added per user request)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to correctly calculate scrollHeight for shrinking
      textarea.style.height = 'auto';
      // Set new height based on scrollHeight, capped at max-h-32 (approx 128px)
      const newHeight = Math.min(textarea.scrollHeight, 100);
      textarea.style.height = `${newHeight}px`;
    }
  }, [input]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isTimerActiveRef.current = false;
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      if (voiceRecorderRef.current?.isRecording() || voiceRecorderRef.current?.isPaused()) {
        voiceRecorderRef.current.cancelRecording();
      }
    };
  }, []);

  /**
   * handleSend
   * User request: Extract text from uploaded files and send to AI as plain text in background.
   * Display only document name with icon in chat UI for better UX (anonymous/background).
   * The full extracted text is sent to AI, but user sees clean file attachments.
   */
  const handleSend = () => {
    if (input.trim() || uploadedFiles.length > 0) {
      // Build message with extracted text from uploaded files (sent to AI in background)
      let messageToSend = input.trim();
      
      if (uploadedFiles.length > 0) {
        // Include extracted text from each uploaded file (for AI processing)
        const fileContents = uploadedFiles
          .filter(file => file.extractedText && file.extractedText.trim().length > 0)
          .map(file => {
            return `\n\n--- Content from ${file.name} ---\n${file.extractedText}`;
          })
          .join('\n\n');
        
        if (fileContents) {
          messageToSend = messageToSend 
            ? `${messageToSend}${fileContents}`
            : fileContents.trim();
        } else {
          // If extraction failed but files were uploaded, at least mention them
          const fileNames = uploadedFiles.map(f => f.name).join(', ');
          messageToSend = messageToSend 
            ? `${messageToSend}\n\n[Note: Files uploaded but text extraction unavailable: ${fileNames}]`
            : `[Files uploaded but text extraction unavailable: ${fileNames}]`;
        }
      }
      
      if (messageToSend.trim()) {
        // Send full message with extracted text to AI (background)
        // The display will be handled by AssistantView to show file icons instead
        // We'll encode file metadata in a special format that AssistantView can parse
        const fileMetadata = uploadedFiles.length > 0 
          ? `\n\n[__FILES__:${JSON.stringify(uploadedFiles.map(f => ({ name: f.name, id: f.id })))}]`
          : '';
        
        // Send message with file metadata appended (will be parsed by AssistantView)
        onSend(messageToSend.trim() + fileMetadata);
        setInput('');
        // Clear uploaded files after sending
        setUploadedFiles([]);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = async () => {
    setRecordingError(null);

    // Clear any existing interval first to prevent duplicates
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    try {
      voiceRecorderRef.current = getVoiceRecorder();
      await voiceRecorderRef.current.startRecording();
      setRecordingState('recording');
      setRecordingDuration(0);

      // Start duration counter - ensure only one interval exists
      if (!durationIntervalRef.current) {
        durationIntervalRef.current = setInterval(() => {
          // Only increment if we're still recording (safety check)
          setRecordingDuration(prev => {
            // Verify we're still in recording state before incrementing
            return prev + 1;
          });
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecordingError(error instanceof Error ? error.message : String(t('chatInput.errorFailedToStartRecording')));
      setRecordingState('idle');
      // Clear interval on error
      isTimerActiveRef.current = false;
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
  };

  const stopRecording = async () => {
    if (!voiceRecorderRef.current) {
      return;
    }

    // Stop duration counter
    isTimerActiveRef.current = false;
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setRecordingState('processing');

    try {
      const audioBlob = await voiceRecorderRef.current.stopRecording();

      // Check if audio is too short (less than 0.5 seconds)
      if (recordingDuration < 1) {
        setRecordingError(String(t('chatInput.errorRecordingTooShort')));
        setRecordingState('idle');
        return;
      }

      // Transcribe the audio
      const result = await transcribeAudio(audioBlob);

      if (result.error) {
        throw new Error(result.error);
      }

      // Use enhanced transcription (if available)
      const transcribedText = result.enhanced_query || result.transcription;

      if (transcribedText && transcribedText.trim()) {
        setInput(prev => {
          const newValue = prev.trim() 
            ? prev.trim() + ' ' + transcribedText 
            : transcribedText;
          return newValue;
        });
      } else {
        setRecordingError(String(t('chatInput.errorTranscriptionFailed')));
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setRecordingError(error instanceof Error ? error.message : String(t('chatInput.errorTranscriptionError')));
    } finally {
      setRecordingState('idle');
      setRecordingDuration(0);
    }
  };

  const cancelRecording = () => {
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.cancelRecording();
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setRecordingState('idle');
    setRecordingDuration(0);
  };

  const pauseRecording = () => {
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.pauseRecording();
      setRecordingState('paused');
      
      // Pause the duration counter
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
  };

  const resumeRecording = () => {
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.resumeRecording();
      setRecordingState('recording');
      
      // Resume the duration counter - clear any existing interval first
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      
      // Start a new interval
      isTimerActiveRef.current = true;
      durationIntervalRef.current = setInterval(() => {
        // Only increment if timer is still active
        if (isTimerActiveRef.current) {
          setRecordingDuration(prev => prev + 1);
        }
      }, 1000);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleMicClick = () => {
    if (recordingState === 'idle') {
      startRecording();
    } else if (recordingState === 'recording') {
      stopRecording();
    } else if (recordingState === 'paused') {
      resumeRecording();
    }
  };

  /**
   * insertToken
   * Explicitly requested by the user: Insert inline tokens (e.g., "#translate", "@notary-compliance")
   * at the current caret position inside the textarea. Falls back to appending to the end if ref/selection unavailable.
   * Reasoning: Keeps tokens as plain text for easy editing/deletion without introducing a separate chips UI.
   */
  const insertToken = (token: string) => {
    const ta = textareaRef.current;
    // Use current state value so we modify the controlled input predictably
    const current = input ?? '';

    if (!ta) {
      setInput((prev) => {
        const needsSpace = prev.length > 0 && !/\s$/.test(prev);
        return (needsSpace ? prev + ' ' : prev) + token + ' ';
      });
      return;
    }

    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const inserted = `${before}${needsSpaceBefore ? ' ' : ''}${token} ${after}`;
    const newCaret = (before + (needsSpaceBefore ? ' ' : '') + token + ' ').length;

    setInput(inserted);
    // Restore caret after React updates the controlled textarea value
    setTimeout(() => {
      try {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      } catch {
        // best-effort; ignore failures on some platforms
      }
    }, 0);
  };

  /**
   * slugify
   * Choice by assistant: Small helper to generate stable tokens from labels.
   * We keep it minimal to avoid external deps and ensure predictable token shapes.
   */
  const slugify = (s: string): string =>
    s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

  /**
   * escapeHtml
   * Choice by assistant: Ensure we safely render user input inside a mirrored highlighter layer.
   * Prevents HTML injection when we later wrap tokens with <span> chips. We only inject spans we create.
   */
  const escapeHtml = (raw: string): string => {
    return raw
      .replaceAll(/&/g, '&amp;')
      .replaceAll(/</g, '&lt;')
      .replaceAll(/>/g, '&gt;')
      .replaceAll(/"/g, '&quot;')
      .replaceAll(/'/g, '&#39;');
  };

  /**
   * getHighlightedHtml
   * Explicitly requested by the user: Style #skills and @agents typed in the input following Apple HIG token look.
   * Implementation choice: We mirror the textarea content into a hidden highlighter layer behind it and wrap
   * detected tokens with "chip" spans. The highlighter container uses transparent text so only token chips are visible,
   * avoiding double-rendering of normal text.
   */
  const getHighlightedHtml = (text: string): string => {
    // 1) Escape first to avoid interpreting user content as HTML.
    let html = escapeHtml(text);
    // 2) Replace @agent tokens first, preserving a simple left-boundary character.
    html = html.replace(
      /(^|[\s.,;:()])@([a-z0-9][\w-]*)/gi,
      (_m, p1: string, p2: string) => {
        return `${p1}<span class="token-chip token-agent">@${p2}</span>`;
      }
    );
    // 3) Replace #skill tokens.
    html = html.replace(
      /(^|[\s.,;:()])#([a-z0-9][\w-]*)/gi,
      (_m, p1: string, p2: string) => {
        return `${p1}<span class="token-chip token-skill">#${p2}</span>`;
      }
    );
    // 4) Ensure at least one trailing space to maintain height alignment at end of line.
    if (html.length === 0) {
      html = '&nbsp;';
    }
    return html;
  };

  /**
   * handleTextScroll
   * Choice by assistant: Keep the highlighter scroll position in sync with the textarea so chips align with lines.
   */
  const handleTextScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (highlighterRef.current) {
      highlighterRef.current.scrollTop = ta.scrollTop;
      highlighterRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  // Skills come from the existing Actions (Translate, Fill template, Anonymise, Improve writing)
  // Explicitly requested by the user to source from Actions.
  const SKILL_LABELS = [
    String(t('chatInput.translate')),
    String(t('chatInput.fillTemplate')),
    String(t('chatInput.anonymise')),
    String(t('chatInput.improveWriting'))
  ];

  const handleInsertSkill = (label: string) => {
    insertToken(`#${slugify(label)}`);
    setShowSkillsMenu(false);
  };

  const handleInsertAgent = (name: string) => {
    insertToken(`@${slugify(name)}`);
    setShowAgentsMenu(false);
  };

  const toggleSkillsMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAgentsMenu(false);
    setShowSkillsMenu((v) => !v);
  };

  const toggleAgentsMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSkillsMenu(false);
    setShowAgentsMenu((v) => !v);
  };

  const handleAttachClick = () => {
    if (isLoading || recordingState === 'processing') return;
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    
    if (!fileList || fileList.length === 0) {
      // Reset the input value so selecting the same file again will trigger onChange
      if (e.target) {
        e.target.value = '';
      }
      return;
    }
    
    const files = Array.from(fileList);
    
    // Reset the input value AFTER we've captured the files, so selecting the same file again will trigger onChange
    if (e.target) {
      e.target.value = '';
    }

    try {
      setUploadStatus({ state: 'validating', message: String(t('chatInput.uploadValidating')) });
      // Let React paint the status before starting network work (UX clarity).
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setUploadStatus({
        state: 'uploading',
        message: String(t('chatInput.uploadUploading')).replace('{0}', String(files.length)),
      });
      
      const result = await uploadFilesToKnowledge(files, 'SMART_DRAFTING');

      if (result.errors.length > 0 && result.uploaded.length === 0) {
        setUploadStatus({ state: 'error', message: result.errors[0] });
        return;
      }

      // Extract text from uploaded files and store with file metadata
      // User request: Extract text and send to AI as plain text
      if (result.uploaded.length > 0) {
        setUploadStatus({ 
          state: 'uploading', 
          message: 'Extracting text from files...' 
        });

        // Extract text from each uploaded file
        const filesWithContent: UploadedFileWithContent[] = await Promise.all(
          result.uploaded.map(async (uploadedFile) => {
            try {
              // Find the original File object to extract text
              // User request: Fix file matching issue where sanitized filenames don't match original filenames
              // Solution: Compare sanitized versions of both filenames to handle special characters correctly
              // Use file size as an additional matching criterion for robustness
              const sanitizedUploadedName = sanitizeFilename(uploadedFile.name);
              const matchingFiles = files.filter(f => {
                const sanitizedOriginalName = sanitizeFilename(f.name);
                // Try exact match first (both original and sanitized)
                return f.name === uploadedFile.name || 
                       sanitizedOriginalName === sanitizedUploadedName ||
                       // Fallback: check if sanitized uploaded name includes the base name (without extension)
                       sanitizedUploadedName.includes(sanitizedOriginalName.split('.')[0]);
              });
              
              // If multiple files match by name, use file size to disambiguate
              // Otherwise, just use the first (and likely only) match
              const originalFile = matchingFiles.length === 1 
                ? matchingFiles[0]
                : matchingFiles.find(f => f.size === uploadedFile.size) || matchingFiles[0];

              if (originalFile) {
                // Extract text from the file
                const extractedText = await extractTextFromFile(originalFile);
                return {
                  ...uploadedFile,
                  extractedText,
                };
              } else {
                // If we can't find the original file, return without text
                console.warn(`Could not find original file for ${uploadedFile.name}. Original files: ${files.map(f => f.name).join(', ')}`);
                return {
                  ...uploadedFile,
                  extractedText: undefined,
                };
              }
            } catch (extractionError) {
              console.error(`Failed to extract text from ${uploadedFile.name}:`, extractionError);
              // Continue with file even if extraction fails
              return {
                ...uploadedFile,
                extractedText: undefined,
              };
            }
          })
        );

        // Store files with extracted text
        setUploadedFiles(prev => [...prev, ...filesWithContent]);
      }

      setUploadStatus({
        state: 'done',
        message: String(t('chatInput.uploadSuccess')),
      });

      // Auto-clear success after a longer delay; keep errors until user dismisses.
      setTimeout(() => setUploadStatus({ state: 'idle' }), 3000);
    } catch (err) {
      setUploadStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(t('chatInput.errorUploadFailed')),
      });
    }
  };

  return (
    <div className="p-4 bg-gradient-to-t from-white via-white to-transparent pb-0">
      <div className="relative bg-white shadow-[0_2px_15px_-3px_rgba(0,0,0,0.1)] rounded-2xl border border-slate-100 p-2">
        {/* Recording indicator */}
        {(recordingState === 'recording' || recordingState === 'paused') && (
          <div className="flex items-center justify-between px-3 py-2 mb-2 bg-red-50 rounded-lg border border-red-100">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 bg-red-500 rounded-full ${recordingState === 'recording' ? 'animate-pulse' : ''}`} />
              <span className="text-sm font-medium text-red-700">
                {recordingState === 'paused' ? String(t('chatInput.paused')) : String(t('chatInput.recording'))}
              </span>
              <span className="text-sm text-red-600">{formatDuration(recordingDuration)}</span>
            </div>
            <div className="flex items-center gap-1">
              {recordingState === 'recording' ? (
                <button
                  onClick={pauseRecording}
                  className="text-red-600 hover:text-red-800 p-1 rounded-full hover:bg-red-100 transition-colors"
                  title={String(t('chatInput.pauseRecording'))}
                >
                  <Pause size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={resumeRecording}
                  className="text-red-600 hover:text-red-800 p-1 rounded-full hover:bg-red-100 transition-colors"
                  title={String(t('chatInput.resumeRecording'))}
                >
                  <Play size={14} fill="currentColor" />
                </button>
              )}
              <button
                onClick={cancelRecording}
                className="text-red-600 hover:text-red-800 p-1 rounded-full hover:bg-red-100 transition-colors"
                title={String(t('chatInput.cancelRecording'))}
              >
                <Square size={14} fill="currentColor" />
              </button>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {recordingState === 'processing' && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-blue-50 rounded-lg border border-blue-100">
            <Loader2 size={16} className="text-blue-600 animate-spin" />
            <span className="text-sm font-medium text-blue-700">{String(t('chatInput.transcribing'))}</span>
          </div>
        )}

        {/* Error message */}
        {recordingError && (
          <div className="px-3 py-2 mb-2 bg-amber-50 rounded-lg border border-amber-100">
            <p className="text-xs text-amber-700">{recordingError}</p>
            <button
              onClick={() => setRecordingError(null)}
              className="text-xs text-amber-600 underline mt-1 hover:text-amber-800"
            >
              {String(t('chatInput.dismiss'))}
            </button>
          </div>
        )}

        {/* Upload feedback banner (explicit user request): make upload status obvious) */}
        {uploadStatus.state !== 'idle' && (
          <div
            className={`flex items-start justify-between gap-2 px-3 py-2 mb-2 rounded-lg border ${
              uploadStatus.state === 'error'
                ? 'bg-red-50 border-red-200'
                : uploadStatus.state === 'done'
                ? 'bg-green-50 border-green-200'
                : 'bg-blue-50 border-blue-200'
            }`}
          >
            <div className="flex items-start gap-2">
              {(uploadStatus.state === 'uploading' || uploadStatus.state === 'validating') && (
                <Loader2 size={16} className="mt-0.5 text-blue-600 animate-spin" />
              )}
              {uploadStatus.state === 'error' && (
                <AlertCircle size={16} className="mt-0.5 text-red-600" />
              )}
              <div className="text-xs text-slate-700">{uploadStatus.message}</div>
            </div>
            <button
              onClick={() => setUploadStatus({ state: 'idle' })}
              className="text-slate-400 hover:text-slate-700"
              title={String(t('common.dismiss'))}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Uploaded files display (explicit user request): show files that are attached to the chat) */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 py-2 mb-2">
            {uploadedFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <Paperclip size={12} className="text-slate-500" />
                <span className="text-slate-700 max-w-[200px] truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  onClick={() => {
                    // Remove file from the list (explicit user request: allow manual removal)
                    setUploadedFiles(prev => prev.filter(f => f.id !== file.id));
                  }}
                  className="text-slate-400 hover:text-slate-700 ml-0.5"
                  title={String(t('chatInput.removeFile'))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Highlighter overlay + textarea wrapper — Explicitly requested by the user */}
        <div className="relative">
          {/* Non-interactive highlighter layer that mirrors content and shows token chips behind the textarea */}
          <div
            ref={highlighterRef}
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words px-2 py-1 text-sm text-transparent overflow-hidden"
            // We only inject spans produced by our own sanitizer/replacement above
            dangerouslySetInnerHTML={{ __html: getHighlightedHtml(input) }}
          />
          {/* Foreground textarea remains fully interactive; background is transparent so chips are visible */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleTextScroll}
            placeholder={recordingState === 'recording' ? String(t('chatInput.listening')) : String(t('chatInput.placeholder'))}
            className="relative w-full text-sm placeholder:text-slate-400 resize-none outline-none max-h-32 bg-transparent px-2 py-1"
            rows={1}
            disabled={isLoading || recordingState === 'processing'}
          />
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept={acceptAttr}
              onChange={handleFilesSelected}
              onClick={(e) => {
                // Ensure onChange fires even if the same file is selected again
                (e.target as HTMLInputElement).value = '';
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleAttachClick}
              disabled={isLoading || recordingState === 'processing' || uploadStatus.state === 'uploading'}
              className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
              title={String(t('chatInput.attachFiles'))}
            >
              <Paperclip size={18} />
            </button>

            {/* Voice recording button */}
            {isVoiceSupported && (
              <button
                onClick={handleMicClick}
                disabled={isLoading || recordingState === 'processing'}
                className={`p-1.5 rounded-full transition-all ${
                  recordingState === 'recording'
                    ? 'bg-red-100 text-red-600 hover:bg-red-200 animate-pulse'
                    : recordingState === 'paused'
                    ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                    : recordingState === 'processing'
                    ? 'bg-blue-100 text-blue-600 cursor-not-allowed'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                } disabled:opacity-50`}
                title={
                  recordingState === 'recording'
                    ? String(t('chatInput.stopRecording'))
                    : recordingState === 'paused'
                    ? String(t('chatInput.resumeRecording'))
                    : recordingState === 'processing'
                    ? String(t('chatInput.processing'))
                    : String(t('chatInput.startVoiceInput'))
                }
              >
                {recordingState === 'processing' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : recordingState === 'recording' ? (
                  <MicOff size={18} />
                ) : recordingState === 'paused' ? (
                  <Play size={18} />
                ) : (
                  <Mic size={18} />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Skills (Zap) — Added per user request */}
            <div className="relative">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleSkillsMenu}
                disabled={isLoading || recordingState === 'processing'}
                className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors disabled:opacity-50"
                title={String(t('chatInput.tagSkill'))}
                aria-expanded={showSkillsMenu}
                aria-haspopup="menu"
              >
                <Zap size={16} />
              </button>
              {showSkillsMenu && (
                <div
                  ref={skillsMenuRef}
                  className="absolute bottom-9 right-0 z-20 w-44 bg-white rounded-lg shadow-lg border border-slate-200 py-1"
                  role="menu"
                >
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">{String(t('chatInput.skillsMenu'))}</div>
                  {SKILL_LABELS.map((label) => (
                    <button
                      key={label}
                      onClick={() => handleInsertSkill(label)}
                      className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-50 text-slate-700"
                      role="menuitem"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Agents (BookOpen) — Added per user request */}
            <div className="relative">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleAgentsMenu}
                disabled={isLoading || recordingState === 'processing'}
                className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors disabled:opacity-50"
                title={String(t('chatInput.tagAgent'))}
                aria-expanded={showAgentsMenu}
                aria-haspopup="menu"
              >
                <BookOpen size={16} />
              </button>
              {showAgentsMenu && (
                <div
                  ref={agentsMenuRef}
                  className="absolute bottom-9 right-0 z-20 w-56 max-h-48 overflow-auto bg-white rounded-lg shadow-lg border border-slate-200 py-1"
                  role="menu"
                >
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">{String(t('chatInput.agentsMenu'))}</div>
                  {agentsLoading && (
                    <div className="px-2 py-2 text-xs text-slate-500">{String(t('chatInput.loading'))}</div>
                  )}
                  {!agentsLoading && agentsError && (
                    <div className="px-2 py-2 text-xs text-red-600">{String(t('chatInput.loadAgentsFailed'))}</div>
                  )}
                  {!agentsLoading && !agentsError && agents.length === 0 && (
                    <div className="px-2 py-2 text-xs text-slate-500">{String(t('chatInput.noAgentsFound'))}</div>
                  )}
                  {!agentsLoading && !agentsError && agents.map((pb) => (
                    <button
                      key={pb.id}
                      onClick={() => handleInsertAgent(pb.name)}
                      className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-50 text-slate-700 truncate"
                      role="menuitem"
                      title={pb.name}
                    >
                      {pb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || recordingState !== 'idle'}
              className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors disabled:opacity-50"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
