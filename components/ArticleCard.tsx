
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NewsArticle, AudioSummary, VoiceName, Language, SummaryHistoryEntry } from '../types.ts';
import { getSummarizedText, generateSpeech } from '../services/geminiService.ts';
import { decode, decodeAudioData, createWavBlob } from '../utils/audioUtils.ts';
import { translations } from '../translations.ts';

interface ArticleCardProps {
  article: NewsArticle;
  onRemove: (id: string) => void;
  onSave?: (article: NewsArticle) => void;
  onUpdateArticle: (article: NewsArticle) => void;
  onStarted?: (id: string) => void;
  onStopped?: (id: string) => void;
  onFinished?: (id: string) => void;
  isActivePlayback?: boolean;
  isSaved?: boolean;
  voice: VoiceName;
  language: Language;
  isDraggable?: boolean;
}

const VOICE_META: Record<VoiceName, { 
  color: string, 
  desc: string, 
  icon: string,
  activeClass: string,
  bgClass: string,
  borderClass: string,
  ringClass: string,
  shadowClass: string
}> = {
  [VoiceName.Kore]: { 
    color: 'indigo', 
    desc: 'Authoritative', 
    icon: '🎙️',
    activeClass: 'text-indigo-600',
    bgClass: 'bg-indigo-50/50',
    borderClass: 'border-indigo-400',
    ringClass: 'ring-indigo-200',
    shadowClass: 'shadow-indigo-100'
  },
  [VoiceName.Puck]: { 
    color: 'cyan', 
    desc: 'Energetic', 
    icon: '✨',
    activeClass: 'text-cyan-600',
    bgClass: 'bg-cyan-50/50',
    borderClass: 'border-cyan-400',
    ringClass: 'ring-cyan-200',
    shadowClass: 'shadow-cyan-100'
  },
  [VoiceName.Charon]: { 
    color: 'emerald', 
    desc: 'Deep', 
    icon: '🌑',
    activeClass: 'text-emerald-600',
    bgClass: 'bg-emerald-50/50',
    borderClass: 'border-emerald-400',
    ringClass: 'ring-emerald-200',
    shadowClass: 'shadow-emerald-100'
  },
  [VoiceName.Fenrir]: { 
    color: 'rose', 
    desc: 'Bold', 
    icon: '🐺',
    activeClass: 'text-rose-600',
    bgClass: 'bg-rose-50/50',
    borderClass: 'border-rose-400',
    ringClass: 'ring-rose-200',
    shadowClass: 'shadow-rose-100'
  },
  [VoiceName.Zephyr]: { 
    color: 'amber', 
    desc: 'Warm', 
    icon: '🍃',
    activeClass: 'text-amber-600',
    bgClass: 'bg-amber-50/50',
    borderClass: 'border-amber-400',
    ringClass: 'ring-amber-200',
    shadowClass: 'shadow-amber-100'
  },
};

const ArticleCard: React.FC<ArticleCardProps> = ({ 
  article, 
  onRemove, 
  onSave, 
  onUpdateArticle, 
  onStarted,
  onStopped,
  onFinished,
  isActivePlayback = false,
  isSaved = false, 
  voice, 
  language,
  isDraggable = false
}) => {
  const [summary, setSummary] = useState<AudioSummary>({
    articleId: article.id,
    summaryText: article.currentSummary?.summaryText || '',
    audioBlob: article.currentSummary?.audioBlob || undefined,
    status: article.currentSummary ? 'ready' : 'idle',
  });
  
  const [localVoice, setLocalVoice] = useState<VoiceName>(article.currentSummary?.voice || voice);
  const [localLanguage, setLocalLanguage] = useState<Language>(article.currentSummary?.language || language);
  const [localPitch, setLocalPitch] = useState<number>(article.currentSummary?.pitch || 0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullTextOpen, setIsFullTextOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [isUrlCopied, setIsUrlCopied] = useState(false);
  const [isContentCopied, setIsContentCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(article.currentSummary?.feedback || null);
  const [starRating, setStarRating] = useState<number | null>(article.currentSummary?.starRating || null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  
  // Undo history stack
  const [undoStack, setUndoStack] = useState<{ feedback: 'positive' | 'negative' | null, starRating: number | null }[]>([]);

  const t = translations[language]; 

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  const contentPreview = useMemo(() => {
    if (!article.content) return '';
    const sentences = article.content.match(/[^.!?]+[.!?]+/g);
    if (!sentences || sentences.length < 1) return article.content.slice(0, 150).trim() + '...';
    return sentences.slice(0, 2).join(' ').trim();
  }, [article.content]);

  useEffect(() => {
    if (summary.status === 'idle') {
      setLocalVoice(voice);
      setLocalLanguage(language);
    }
  }, [voice, language, summary.status]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (isActivePlayback && !isPlaying && summary.status === 'ready') {
      const resumeTime = currentTime >= (duration || 0) ? 0 : currentTime;
      startPlayback(resumeTime);
    } else if (!isActivePlayback && isPlaying) {
      stopPlayback();
    }
  }, [isActivePlayback, summary.status]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceNodeRef.current) {
        try { 
          sourceNodeRef.current.onended = null;
          sourceNodeRef.current.stop(); 
        } catch (e) {}
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const updateProgress = () => {
    if (audioContextRef.current && isPlaying) {
      const elapsed = audioContextRef.current.currentTime - playbackStartTimeRef.current;
      if (elapsed >= (audioBufferRef.current?.duration || 0)) {
        setCurrentTime(audioBufferRef.current?.duration || 0);
        setIsPlaying(false);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      } else {
        setCurrentTime(Math.max(0, elapsed));
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    }
  };

  const handleGenerate = async () => {
    try {
      let summaryText = '';
      setSummary(prev => ({ ...prev, status: 'summarizing', error: undefined }));
      try {
        summaryText = await getSummarizedText(article.content, localLanguage);
      } catch (err: any) {
        throw new Error('summarization');
      }
      
      setSummary(prev => ({ ...prev, summaryText, status: 'generating-audio', error: undefined }));
      try {
        const audioBase64 = await generateSpeech(summaryText, localVoice, localPitch);
        audioBufferRef.current = null; 
        
        const newEntry: SummaryHistoryEntry = {
          id: Math.random().toString(36).substr(2, 9),
          summaryText,
          audioBlob: audioBase64,
          voice: localVoice,
          language: localLanguage,
          pitch: localPitch,
          timestamp: Date.now(),
        };

        const updatedHistory = article.summaryHistory ? [ ...article.summaryHistory ] : [];
        if (article.currentSummary) {
          updatedHistory.unshift(article.currentSummary);
        }

        onUpdateArticle({
          ...article,
          currentSummary: newEntry,
          summaryHistory: updatedHistory
        });

        setSummary({
          articleId: article.id,
          summaryText,
          audioBlob: audioBase64,
          status: 'ready'
        });
        setFeedback(null);
        setStarRating(null);
        setUndoStack([]);
      } catch (err: any) {
        throw new Error('audio');
      }
    } catch (err: any) {
      setSummary(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  const handleRestore = (entry: SummaryHistoryEntry) => {
    const oldCurrent = article.currentSummary;
    const filteredHistory = article.summaryHistory?.filter(e => e.id !== entry.id) || [];
    const newHistory = oldCurrent ? [oldCurrent, ...filteredHistory] : filteredHistory;

    onUpdateArticle({
      ...article,
      currentSummary: entry,
      summaryHistory: newHistory
    });

    setSummary({
      articleId: article.id,
      summaryText: entry.summaryText,
      audioBlob: entry.audioBlob,
      status: 'ready'
    });
    setLocalVoice(entry.voice);
    setLocalLanguage(entry.language);
    setLocalPitch(entry.pitch || 0);
    setFeedback(entry.feedback || null);
    setStarRating(entry.starRating || null);
    setUndoStack([]);
    setIsHistoryOpen(false);
    
    audioBufferRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    if (isPlaying) stopPlayback();
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all versions?')) {
      onUpdateArticle({ ...article, summaryHistory: [] });
      setIsHistoryOpen(false);
    }
  };

  const startPlayback = async (offset = 0) => {
    if (!summary.audioBlob) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      if (!gainNodeRef.current) {
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
      }
      gainNodeRef.current.gain.value = volume;
      if (!audioBufferRef.current) {
        const rawData = decode(summary.audioBlob);
        audioBufferRef.current = await decodeAudioData(rawData, audioContextRef.current, 24000, 1);
      }
      
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch (e) {}
      }

      const bufDuration = audioBufferRef.current.duration;
      setDuration(bufDuration);
      const safeOffset = Math.max(0, Math.min(bufDuration, offset));
      setCurrentTime(safeOffset);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(gainNodeRef.current);
      source.onended = () => {
        if (sourceNodeRef.current === source) {
          setIsPlaying(false);
          setCurrentTime(bufDuration);
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          onFinished?.(article.id);
        }
      };
      sourceNodeRef.current = source;
      playbackStartTimeRef.current = audioContextRef.current.currentTime - safeOffset;
      source.start(0, safeOffset);
      setIsPlaying(true);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updateProgress);
      onStarted?.(article.id);
    } catch (err: any) {
      setSummary(prev => ({ ...prev, status: 'error', error: `playback` }));
    }
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.onended = null; sourceNodeRef.current.stop(); } catch (e) {}
    }
    setIsPlaying(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    onStopped?.(article.id);
  };

  const togglePlayback = async () => {
    if (isPlaying) { stopPlayback(); return; }
    startPlayback(currentTime >= duration ? 0 : currentTime);
  };

  const handleFeedback = (type: 'positive' | 'negative') => {
    // Record history
    setUndoStack(prev => [...prev, { feedback, starRating }]);
    
    const nextFeedback = feedback === type ? null : type;
    setFeedback(nextFeedback);
    if (article.currentSummary) {
      onUpdateArticle({ ...article, currentSummary: { ...article.currentSummary, feedback: nextFeedback || undefined } });
    }
  };

  const handleStarRating = (rating: number) => {
    // Record history
    setUndoStack(prev => [...prev, { feedback, starRating }]);

    setStarRating(rating);
    if (article.currentSummary) {
      onUpdateArticle({ ...article, currentSummary: { ...article.currentSummary, starRating: rating } });
    }
  };

  const handleUndoAction = () => {
    if (undoStack.length === 0) return;
    
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    
    setFeedback(previousState.feedback);
    setStarRating(previousState.starRating);
    
    if (article.currentSummary) {
      onUpdateArticle({ 
        ...article, 
        currentSummary: { 
          ...article.currentSummary, 
          feedback: previousState.feedback || undefined, 
          starRating: previousState.starRating || undefined 
        } 
      });
    }
  };

  const renderVoiceSelector = () => {
    return (
      <div className="mt-4 animate-in slide-in-from-top-4 duration-500">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block ml-1">Select Persona</label>
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(VOICE_META) as VoiceName[]).map((v) => {
            const isActive = localVoice === v;
            const meta = VOICE_META[v];
            return (
              <button
                key={v}
                onClick={() => setLocalVoice(v)}
                className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 active:scale-95 group ${
                  isActive 
                  ? `${meta.borderClass} ${meta.bgClass} ${meta.shadowClass} scale-105 z-10 shadow-lg` 
                  : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                }`}
              >
                <span className={`text-xl mb-1 transition-transform group-hover:scale-110 ${isActive ? 'animate-bounce' : ''}`}>
                  {meta.icon}
                </span>
                <span className={`text-[9px] font-black uppercase tracking-tighter ${isActive ? meta.activeClass : 'text-slate-400 dark:text-slate-500'}`}>
                  {v}
                </span>
                <span className={`text-[7px] font-bold text-slate-300 text-center leading-none mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity dark:text-slate-500`}>
                  {meta.desc}
                </span>
                {isActive && (
                  <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 ${meta.activeClass.replace('text', 'bg')} rounded-full border-2 border-white flex items-center justify-center`}>
                    <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLoadingProgress = () => {
    const isSummarizing = summary.status === 'summarizing';
    const isGeneratingAudio = summary.status === 'generating-audio';
    if (!isSummarizing && !isGeneratingAudio) return null;

    return (
      <div className="py-8 px-6 bg-slate-50/80 rounded-[2.5rem] border border-slate-200/60 shadow-inner animate-in fade-in slide-in-from-top-2 duration-500 overflow-hidden relative dark:bg-slate-900/70 dark:border-slate-800/80">
        <div className="absolute top-4 right-4 flex gap-1.5">
          {[...Array(3)].map((_, i) => (
            <div 
              key={i} 
              className="w-1.5 h-1.5 bg-indigo-200 rounded-full animate-bounce" 
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>

        <div className="flex flex-col gap-6">
          <div className={`transition-all duration-500 ${isGeneratingAudio ? 'opacity-40' : ''}`}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm transition-all duration-500 ${isSummarizing ? 'bg-indigo-600 text-white animate-pulse' : 'bg-emerald-500 text-white'}`}>
                  {isSummarizing ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Stage 1: AI Summary</h4>
                  <p className="text-[11px] font-bold text-slate-400 dark:text-slate-400">
                    {isSummarizing ? t.summarizing.replace('{lang}', localLanguage) : 'Summary Created'}
                  </p>
                </div>
              </div>
              {isSummarizing && <span className="text-[10px] font-black text-indigo-400 tracking-widest animate-pulse">EXTRACTING...</span>}
            </div>
            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden relative shadow-sm dark:bg-slate-800">
              <div 
                className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-1000 ease-in-out ${isSummarizing ? 'w-[85%]' : 'w-full'}`}
              />
            </div>
          </div>

          <div className={`transition-all duration-500 ${isSummarizing ? 'opacity-30' : ''}`}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm transition-all duration-500 ${isGeneratingAudio ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-200 text-slate-400'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Stage 2: Voice Generation</h4>
                  <p className="text-[11px] font-bold text-slate-400 dark:text-slate-400">
                    {isGeneratingAudio ? t.craftingVoice : isSummarizing ? 'Waiting...' : 'Generating Audio...'}
                  </p>
                </div>
              </div>
              {isGeneratingAudio && (
                <div className="flex items-end gap-0.5 h-3">
                  {[...Array(6)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-0.5 bg-indigo-500 rounded-full animate-pulse" 
                      style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden relative shadow-sm dark:bg-slate-800">
              <div 
                className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-1000 ease-in-out ${isGeneratingAudio ? 'w-[65%]' : 'w-0'}`}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all duration-300 flex flex-col h-full group/card dark:bg-slate-900 ${isActivePlayback ? 'border-indigo-400 ring-2 ring-indigo-50 shadow-indigo-100 dark:ring-indigo-900/40' : 'border-slate-100 dark:border-slate-800'}`}>
      <div className="p-6 flex flex-col flex-1">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
            <div className="flex-1 min-w-0">
              <h3 className={`text-lg font-bold line-clamp-2 leading-tight transition-colors ${isActivePlayback ? 'text-indigo-600' : 'text-slate-800 group-hover/card:text-indigo-600 dark:text-slate-100 dark:group-hover/card:text-indigo-300'}`}>{article.title}</h3>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                {article.source && <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded dark:text-indigo-300 dark:bg-indigo-950/40">{article.source}</span>}
                <div className="flex items-center gap-2.5">
                  <button onClick={() => setIsFullTextOpen(true)} className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1 dark:text-slate-400 dark:hover:text-indigo-300">{t.fullText}</button>
                  <button onClick={() => setIsHistoryOpen(true)} className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1 dark:text-slate-400 dark:hover:text-indigo-300">{t.history}</button>
                </div>
              </div>
            </div>
          </div>
          <button onClick={() => onRemove(article.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1 ml-2 shrink-0 dark:text-slate-500 dark:hover:text-red-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-2 mb-4">
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 font-medium italic dark:text-slate-400">{contentPreview}</p>
        </div>

        <div className="mt-auto space-y-4">
          {(summary.status === 'idle' || summary.status === 'error') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${isSettingsOpen ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${isSettingsOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                  {t.audioSettings}
                </button>
                {isSettingsOpen && (
                  <span className="text-[10px] font-bold text-slate-300 italic dark:text-slate-500">{VOICE_META[localVoice].desc} reporter style</span>
                )}
              </div>

              {isSettingsOpen && renderVoiceSelector()}

              <button 
                onClick={handleGenerate} 
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg transition-all flex items-center justify-center gap-3 active:scale-[0.98] hover:bg-indigo-700 hover:shadow-indigo-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {t.generateBriefing}
              </button>
            </div>
          )}

          {renderLoadingProgress()}

          {summary.status === 'ready' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className={`p-5 rounded-3xl border transition-colors duration-500 ${isActivePlayback ? 'bg-indigo-50/50 border-indigo-200 shadow-inner dark:bg-indigo-950/40 dark:border-indigo-900' : 'bg-slate-50 border-slate-100 dark:bg-slate-950 dark:border-slate-800'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-sm ${VOICE_META[localVoice].bgClass} ${VOICE_META[localVoice].borderClass} border`}>
                    {VOICE_META[localVoice].icon}
                  </div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest dark:text-slate-400">{localVoice} Reporting</span>
                </div>
                
                <p className="text-base text-slate-700 italic font-medium leading-relaxed dark:text-slate-200">"{summary.summaryText}"</p>
                
                <div className="mt-4 flex flex-wrap justify-between items-center gap-4 border-t border-slate-200/60 pt-4 dark:border-slate-800">
                   <div className="flex items-center gap-2">
                     <button onClick={togglePlayback} className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform hover:bg-indigo-700">
                       {isPlaying ? (
                         <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                       ) : (
                         <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                       )}
                     </button>
                     <div className="text-[10px] font-black tabular-nums text-slate-400 uppercase tracking-widest dark:text-slate-500">{formatTime(currentTime)} / {formatTime(duration)}</div>
                   </div>

                   <div className="flex flex-col gap-2 items-end">
                     <div className="flex items-center gap-1.5">
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mr-1 dark:text-slate-500">Quality:</span>
                       <div className="flex items-center" onMouseLeave={() => setHoverRating(null)}>
                         {[1, 2, 3, 4, 5].map((star) => (
                           <button
                             key={star}
                             onMouseEnter={() => setHoverRating(star)}
                             onClick={() => handleStarRating(star)}
                             className="p-0.5 transition-transform hover:scale-125 active:scale-95"
                           >
                             <svg 
                               className={`w-4 h-4 transition-colors ${
                                 star <= (hoverRating || starRating || 0) 
                                   ? 'text-amber-400 fill-current' 
                                   : 'text-slate-200 fill-none dark:text-slate-700'
                               }`} 
                               viewBox="0 0 24 24" 
                               stroke="currentColor" 
                               strokeWidth="2"
                             >
                               <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.921-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                             </svg>
                           </button>
                         ))}
                       </div>
                     </div>

                     <div className="flex items-center gap-3">
                       <div className="flex bg-white rounded-lg border border-slate-100 p-0.5 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                         <button 
                           onClick={() => handleFeedback('positive')} 
                           className={`p-1.5 rounded-md transition-all ${feedback === 'positive' ? 'bg-indigo-600 text-white shadow-indigo-100' : 'text-slate-300 hover:text-indigo-400 dark:text-slate-500 dark:hover:text-indigo-300'}`} 
                           title="Accurate"
                         >
                           <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                         </button>
                         <button 
                           onClick={() => handleFeedback('negative')} 
                           className={`p-1.5 rounded-md transition-all ${feedback === 'negative' ? 'bg-rose-500 text-white shadow-rose-100' : 'text-slate-300 hover:text-rose-400 dark:text-slate-500 dark:hover:text-rose-300'}`} 
                           title="Inaccurate"
                         >
                           <svg className="w-3.5 h-3.5 rotate-180" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                         </button>
                       </div>
                       {undoStack.length > 0 && (
                         <button 
                           onClick={handleUndoAction} 
                           className="text-[9px] font-black uppercase text-indigo-500 hover:text-indigo-700 transition-colors flex items-center gap-1 group/undo animate-in zoom-in duration-200 dark:text-indigo-300 dark:hover:text-indigo-200"
                           title={t.undo}
                         >
                           <svg className="w-3 h-3 transition-transform group-hover/undo:-rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                           </svg>
                           {t.undo}
                         </button>
                       )}
                        {undoStack.length === 0 && (feedback || starRating) && (
                          <button 
                            onClick={() => { setFeedback(null); setStarRating(null); }}
                            className="text-[9px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors flex items-center gap-1 dark:text-slate-500 dark:hover:text-indigo-300"
                          >
                            Reset
                          </button>
                        )}
                     </div>
                   </div>
                </div>
                <div className="mt-4 h-1 w-full bg-slate-200 rounded-full overflow-hidden dark:bg-slate-800">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-100 ease-linear"
                    style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isFullTextOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2rem] p-8 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-300 dark:bg-slate-900">
            <h2 className="text-xl font-black mb-4 dark:text-slate-100">{article.title}</h2>
            <div className="text-slate-600 whitespace-pre-wrap leading-relaxed dark:text-slate-300">{article.content}</div>
            <button onClick={() => setIsFullTextOpen(false)} className="mt-8 px-6 py-3 bg-slate-900 text-white rounded-xl font-bold active:scale-95 transition-transform dark:bg-slate-100 dark:text-slate-900">Close</button>
          </div>
        </div>
      )}
      
      {isHistoryOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2rem] p-8 animate-in zoom-in-95 duration-300 dark:bg-slate-900">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black dark:text-slate-100">{t.summaryHistory}</h2>
              {article.summaryHistory && article.summaryHistory.length > 0 && (
                <button onClick={handleClearHistory} className="text-[10px] font-black text-red-500 uppercase hover:underline">Clear all</button>
              )}
            </div>
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
              {!article.summaryHistory || article.summaryHistory.length === 0 ? (
                <p className="text-center text-slate-400 py-10 font-medium italic dark:text-slate-500">{t.noHistory}</p>
              ) : (
                article.summaryHistory.map(entry => (
                  <div key={entry.id} className="p-4 border border-slate-100 rounded-2xl flex justify-between items-center bg-slate-50 hover:bg-white hover:border-indigo-100 hover:shadow-sm transition-all dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black text-indigo-500 uppercase">{new Date(entry.timestamp).toLocaleString()}</p>
                      <div className="flex items-center gap-1 mb-1">
                        {[1, 2, 3, 4, 5].map(s => (
                          <svg 
                            key={s} 
                            className={`w-2.5 h-2.5 ${s <= (entry.starRating || 0) ? 'text-amber-400 fill-current' : 'text-slate-200 dark:text-slate-700'}`} 
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        ))}
                      </div>
                      <p className="text-xs text-slate-600 italic line-clamp-1 dark:text-slate-300">"{entry.summaryText}"</p>
                    </div>
                    <button onClick={() => handleRestore(entry)} className="ml-4 px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-black rounded-lg uppercase shadow-sm active:scale-95 transition-transform">{t.restore}</button>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setIsHistoryOpen(false)} className="mt-8 w-full py-4 bg-slate-100 text-slate-600 rounded-xl font-bold active:scale-95 transition-transform dark:bg-slate-800 dark:text-slate-200">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleCard;
