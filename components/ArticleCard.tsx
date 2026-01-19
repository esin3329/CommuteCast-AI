
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NewsArticle, AudioSummary, VoiceName, Language, SummaryHistoryEntry } from '../types';
import { getSummarizedText, generateSpeech } from '../services/geminiService';
import { decode, decodeAudioData, createWavBlob } from '../utils/audioUtils';
import { translations } from '../translations';

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
    desc: 'Authoritative & Professional', 
    icon: '🎙️',
    activeClass: 'text-indigo-600',
    bgClass: 'bg-indigo-50',
    borderClass: 'border-indigo-200',
    ringClass: 'ring-indigo-500',
    shadowClass: 'shadow-indigo-100'
  },
  [VoiceName.Puck]: { 
    color: 'cyan', 
    desc: 'Lighthearted & Energetic', 
    icon: '✨',
    activeClass: 'text-cyan-600',
    bgClass: 'bg-cyan-50',
    borderClass: 'border-cyan-200',
    ringClass: 'ring-cyan-500',
    shadowClass: 'shadow-cyan-100'
  },
  [VoiceName.Charon]: { 
    color: 'emerald', 
    desc: 'Deep & Commanding', 
    icon: '🌑',
    activeClass: 'text-emerald-600',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    ringClass: 'ring-emerald-500',
    shadowClass: 'shadow-emerald-100'
  },
  [VoiceName.Fenrir]: { 
    color: 'rose', 
    desc: 'Bold & Direct', 
    icon: '🐺',
    activeClass: 'text-rose-600',
    bgClass: 'bg-rose-50',
    borderClass: 'border-rose-200',
    ringClass: 'ring-rose-500',
    shadowClass: 'shadow-rose-100'
  },
  [VoiceName.Zephyr]: { 
    color: 'amber', 
    desc: 'Smooth & Warm', 
    icon: '🍃',
    activeClass: 'text-amber-600',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    ringClass: 'ring-amber-500',
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
  
  // Local states
  const [localVoice, setLocalVoice] = useState<VoiceName>(article.currentSummary?.voice || voice);
  const [localLanguage, setLocalLanguage] = useState<Language>(article.currentSummary?.language || language);
  const [localPitch, setLocalPitch] = useState<number>(article.currentSummary?.pitch || 0);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
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
  
  const t = translations[language]; 

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Extract first 2 sentences for preview
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

  // Coordinate playback with App state
  useEffect(() => {
    if (isActivePlayback && !isPlaying && summary.status === 'ready') {
      startPlayback(currentTime >= duration ? 0 : currentTime);
    } else if (!isActivePlayback && isPlaying) {
      stopPlayback();
    }
  }, [isActivePlayback, summary.status, currentTime, duration]);

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
      if (elapsed >= duration) {
        setCurrentTime(duration);
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
    setIsHistoryOpen(false);
    
    // Reset player state for restoration
    audioBufferRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    if (isPlaying) stopPlayback();
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear all historical versions for this article?')) {
      onUpdateArticle({
        ...article,
        summaryHistory: []
      });
      setIsHistoryOpen(false);
    }
  };

  const handleDownload = () => {
    if (!summary.audioBlob) return;
    const rawData = decode(summary.audioBlob);
    const wavBlob = createWavBlob(rawData, 24000);
    const url = URL.createObjectURL(wavBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeTitle = article.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    anchor.download = `commute_cast_${safeTitle}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleExportAudio = async () => {
    if (!summary.audioBlob) return;
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const rawData = decode(summary.audioBlob);
    const wavBlob = createWavBlob(rawData, 24000);
    const url = URL.createObjectURL(wavBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeTitle = article.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    anchor.download = `CommuteCast_HQ_${safeTitle}_${localVoice}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setIsExporting(false);
  };

  const handleShare = async () => {
    if (!article.url) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: `Check out this briefing: ${article.title}`,
          url: article.url,
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      try {
        await navigator.clipboard.writeText(article.url);
        alert('Link copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy link:', err);
      }
    }
  };

  const handleCopyUrl = async () => {
    if (!article.url) return;
    try {
      await navigator.clipboard.writeText(article.url);
      setIsUrlCopied(true);
      setTimeout(() => setIsUrlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  const handleCopy = async () => {
    if (!summary.summaryText) return;
    try {
      await navigator.clipboard.writeText(summary.summaryText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy summary:', err);
    }
  };

  const handleCopyFullContent = async () => {
    try {
      await navigator.clipboard.writeText(`${article.title}\n\n${article.content}`);
      setIsContentCopied(true);
      setTimeout(() => setIsContentCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy content:', err);
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
        try {
          audioBufferRef.current = await decodeAudioData(rawData, audioContextRef.current, 24000, 1);
        } catch (e) {
          throw new Error("playback");
        }
      }
      if (sourceNodeRef.current) {
        try { 
          sourceNodeRef.current.onended = null;
          sourceNodeRef.current.stop(); 
        } catch (e) {}
      }
      const bufDuration = audioBufferRef.current.duration;
      setDuration(bufDuration);
      const safeOffset = Math.max(0, Math.min(bufDuration, offset));
      setCurrentTime(safeOffset);
      if (safeOffset >= bufDuration) {
        setIsPlaying(false);
        onFinished?.(article.id);
        return;
      }
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
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
      } catch (e) {}
    }
    setIsPlaying(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    onStopped?.(article.id);
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const startPoint = currentTime >= duration ? 0 : currentTime;
    await startPlayback(startPoint);
  };

  const handleReplay = async () => {
    await startPlayback(0);
  };

  const handleSkip = (seconds: number) => {
    const nextTime = Math.max(0, Math.min(duration, currentTime + seconds));
    setCurrentTime(nextTime);
    if (isPlaying) {
      startPlayback(nextTime);
    }
  };

  const clearFeedback = () => {
    setFeedback(null);
    if (article.currentSummary) {
      onUpdateArticle({
        ...article,
        currentSummary: { ...article.currentSummary, feedback: undefined }
      });
    }
  };

  const handleFeedback = (type: 'positive' | 'negative') => {
    if (feedback === type) {
      clearFeedback();
    } else {
      setFeedback(type);
      if (article.currentSummary) {
        onUpdateArticle({
          ...article,
          currentSummary: { ...article.currentSummary, feedback: type }
        });
      }
      console.log(`[Feedback Log] Article ID: ${article.id}, Type: ${type}, Voice: ${localVoice}`);
    }
  };

  const getWordCount = (text: string) => {
    if (!text) return 0;
    return text.trim().split(/\s+/).length;
  };

  const renderError = () => {
    if (summary.status !== 'error') return null;
    let message = t.fetchError;
    let action = t.retry;
    let onClick = handleGenerate;
    if (summary.error === 'summarization') {
      message = t.errSummarization;
      action = t.retrySummary;
    } else if (summary.error === 'audio') {
      message = t.errAudio;
      action = t.retryAudio;
    } else if (summary.error === 'playback') {
      message = t.errPlayback;
      action = t.retryPlayback;
      onClick = () => startPlayback(currentTime);
    }
    return (
      <div className="p-3 bg-red-50 border border-red-100 rounded-xl space-y-3 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <p className="text-[11px] text-red-600 font-bold leading-tight">{message}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClick} className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-sm">{action}</button>
          <button onClick={() => setSummary({ ...summary, status: 'idle' })} className="px-3 py-2 bg-white text-slate-500 hover:text-slate-800 rounded-lg text-[10px] font-bold transition-all border border-slate-200">Reset</button>
        </div>
      </div>
    );
  };

  const renderLoadingProgress = () => {
    const isSummarizing = summary.status === 'summarizing';
    const isGeneratingAudio = summary.status === 'generating-audio';
    if (!isSummarizing && !isGeneratingAudio) return null;

    return (
      <div className="py-6 px-5 bg-slate-50/80 rounded-[2rem] border border-slate-200/60 shadow-inner animate-in fade-in slide-in-from-top-2 duration-500 overflow-hidden relative">
        <div className="absolute top-0 right-0 p-4">
           <div className="flex gap-1">
              {[...Array(3)].map((_, i) => (
                <div 
                  key={i} 
                  className="w-1.5 h-1.5 bg-indigo-200 rounded-full animate-bounce" 
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
           </div>
        </div>

        <div className="flex flex-col gap-5">
          {/* Stage 1: Summarization */}
          <div className={`transition-all duration-500 ${isGeneratingAudio ? 'opacity-40 grayscale-[0.5]' : ''}`}>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shadow-sm transition-all duration-500 ${isSummarizing ? 'bg-indigo-600 text-white animate-[pulse_1.5s_infinite]' : 'bg-slate-200 text-slate-500'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                </div>
                <div>
                  <h4 className={`text-[10px] font-black uppercase tracking-widest ${isSummarizing ? 'text-indigo-600' : 'text-slate-400'}`}>Stage 1: AI Analysis</h4>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    {isSummarizing ? t.summarizing.replace('{lang}', localLanguage) : 'Summary Ready'}
                  </p>
                </div>
              </div>
              {isSummarizing && (
                <span className="text-[10px] font-black text-indigo-500/50 animate-pulse tracking-widest">75%</span>
              )}
              {isGeneratingAudio && (
                 <div className="bg-emerald-100 text-emerald-600 rounded-full p-0.5 animate-in zoom-in duration-300">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" d="M5 13l4 4L19 7" /></svg>
                 </div>
              )}
            </div>
            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden relative shadow-sm border border-white/40">
              <div 
                className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-1000 ease-in-out ${isSummarizing ? 'w-3/4 animate-[shimmer_2s_infinite]' : 'w-full'}`}
                style={{ backgroundImage: isSummarizing ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)' : 'none', backgroundSize: '200% 100%' }}
              />
            </div>
          </div>

          {/* Stage 2: Audio Generation */}
          <div className={`transition-all duration-500 ${isSummarizing ? 'opacity-30' : ''}`}>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shadow-sm transition-all duration-500 ${isGeneratingAudio ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                   <svg className={`w-4 h-4 ${isGeneratingAudio ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </div>
                <div>
                  <h4 className={`text-[10px] font-black uppercase tracking-widest ${isGeneratingAudio ? 'text-indigo-600' : 'text-slate-400'}`}>Stage 2: Voice Synthesis</h4>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    {isGeneratingAudio ? t.craftingVoice : isSummarizing ? 'Waiting...' : 'Processing...'}
                  </p>
                </div>
              </div>
              {isGeneratingAudio && (
                <div className="flex items-end gap-0.5 mb-1 h-3">
                  {[...Array(6)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-1 bg-indigo-500/60 rounded-full animate-[pulse_0.8s_infinite]" 
                      style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden relative shadow-sm border border-white/40">
              <div 
                className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-1000 ease-in-out ${isGeneratingAudio ? 'w-1/2 animate-[shimmer_2s_infinite]' : (isSummarizing ? 'w-0' : 'w-full')}`}
                style={{ backgroundImage: isGeneratingAudio ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)' : 'none', backgroundSize: '200% 100%' }}
              />
            </div>
          </div>
        </div>

        <style>{`
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all duration-300 flex flex-col h-full group/card ${isActivePlayback ? 'border-indigo-400 ring-2 ring-indigo-50 shadow-indigo-100' : 'border-slate-100'}`}>
      <div className="p-6 flex flex-col flex-1">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
            {isDraggable && (
              <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-indigo-400 transition-colors p-1" title="Drag to reorder">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 9h8M8 15h8" />
                  <circle cx="9" cy="9" r="0.5" fill="currentColor" />
                  <circle cx="12" cy="9" r="0.5" fill="currentColor" />
                  <circle cx="15" cy="9" r="0.5" fill="currentColor" />
                  <circle cx="9" cy="15" r="0.5" fill="currentColor" />
                  <circle cx="12" cy="15" r="0.5" fill="currentColor" />
                  <circle cx="15" cy="15" r="0.5" fill="currentColor" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`text-lg font-bold line-clamp-2 leading-tight transition-colors ${isActivePlayback ? 'text-indigo-600' : 'text-slate-800 group-hover/card:text-indigo-600'}`}>{article.title}</h3>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                {article.source && (
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded">
                    {article.source}
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  {article.url && (
                    <>
                      <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1" title={t.link}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        {t.link}
                      </a>
                      <button 
                        onClick={handleCopyUrl} 
                        className={`text-xs font-medium transition-colors flex items-center gap-1 ${isUrlCopied ? 'text-green-600 font-bold' : 'text-slate-400 hover:text-indigo-500'}`} 
                        title={t.copyUrl}
                      >
                        {isUrlCopied ? (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        )}
                        {isUrlCopied ? t.urlCopied : t.copyUrl}
                      </button>
                      <button onClick={handleShare} className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1" title={t.share}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6L15.316 7.658M21 12a3 3 0 11-6 0 3 3 0 016 0zm-6 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {t.share}
                      </button>
                      <button onClick={() => setIsFullTextOpen(true)} className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1" title={t.fullText}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        {t.fullText}
                      </button>
                      <button onClick={() => setIsHistoryOpen(true)} className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors flex items-center gap-1" title={t.history}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {t.history}
                      </button>
                      {onSave && (
                        <button 
                          onClick={() => onSave(article)} 
                          className={`text-xs font-medium transition-colors flex items-center gap-1 ${isSaved ? 'text-indigo-600 font-bold' : 'text-slate-400 hover:text-indigo-500'}`}
                          title={t.saveForLater}
                        >
                          <svg className="w-3 h-3" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                          </svg>
                          {isSaved ? t.saved : t.saveForLater}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button onClick={() => onRemove(article.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1 ml-2 shrink-0" aria-label="Remove article">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content Preview */}
        <div className="mt-2 mb-4">
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 font-medium italic">
            {contentPreview}
          </p>
        </div>

        <div className="mb-4">
          <button onClick={() => setIsContentExpanded(!isContentExpanded)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors group">
            <span>{isContentExpanded ? t.hideOriginal : t.viewOriginal}</span>
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isContentExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {isContentExpanded && (
            <div className="mt-2 bg-slate-50/50 border border-slate-100 rounded-lg p-3 max-h-40 overflow-y-auto animate-in slide-in-from-top-1 duration-200">
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{article.content}</p>
            </div>
          )}
        </div>

        <div className="mt-auto space-y-4">
          {(summary.status === 'idle' || summary.status === 'error') && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="bg-slate-50 p-5 rounded-[2.5rem] border border-slate-100 shadow-inner">
                <div className="flex justify-between items-center mb-5 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-5 bg-indigo-500 rounded-full"></div>
                    <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{t.audioSettings || 'Audio Settings'}</h4>
                  </div>
                  <select 
                    value={localLanguage} 
                    onChange={(e) => setLocalLanguage(e.target.value as Language)} 
                    className="text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {Object.values(Language).map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-6">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-1">{t.voice}</label>
                  <div className="grid grid-cols-5 gap-3">
                    {Object.values(VoiceName).map(v => {
                      const meta = VOICE_META[v];
                      const active = localVoice === v;
                      return (
                        <button 
                          key={v}
                          onClick={() => setLocalVoice(v)}
                          className={`relative group flex flex-col items-center p-3 rounded-3xl transition-all border duration-300 ease-out active:scale-95 ${active ? `bg-white ${meta.borderClass} ${meta.shadowClass} shadow-xl ring-2 ${meta.ringClass} ring-offset-4 ring-offset-slate-50 scale-105` : 'bg-white/40 border-transparent hover:bg-white hover:border-slate-200'}`}
                        >
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl mb-2 shadow-sm transition-all duration-500 ${active ? `scale-110 ${meta.bgClass}` : 'bg-slate-100/50 group-hover:scale-105 group-hover:bg-white'}`}>
                            <span className={`relative ${active ? 'animate-[bounce_2s_infinite]' : ''}`}>
                              {meta.icon}
                              {active && <span className={`absolute -inset-1 rounded-full animate-ping opacity-30 ${meta.bgClass}`}></span>}
                            </span>
                          </div>
                          <span className={`text-[10px] font-black uppercase tracking-tighter transition-colors duration-200 ${active ? meta.activeClass : 'text-slate-400'}`}>
                            {v}
                          </span>
                          
                          {active && (
                            <div className="absolute -top-2 -right-2 bg-white rounded-full p-0.5 shadow-lg border border-slate-100 animate-in zoom-in spin-in-12 duration-500">
                               <div className={`${meta.activeClass} bg-white rounded-full p-0.5`}>
                                 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>
                               </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5 px-1 flex justify-center">
                     <p className="text-[10px] font-black text-slate-400 italic text-center uppercase tracking-widest animate-in slide-in-from-bottom-1 duration-300 bg-white/60 px-4 py-1.5 rounded-full border border-slate-200/40 shadow-sm backdrop-blur-sm">
                       {VOICE_META[localVoice].desc}
                     </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200/50">
                  <div className="flex justify-between items-end mb-4 px-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.pitch}</label>
                    <div className="flex items-center gap-3">
                       <button 
                         onClick={() => setLocalPitch(0)}
                         className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-700 transition-colors px-2 py-1 bg-white rounded-lg border border-slate-100 shadow-sm"
                       >
                         {t.resetPitch || 'Reset'}
                       </button>
                       <span className={`text-[11px] font-black px-3 py-1 rounded-xl bg-white border border-slate-200 shadow-sm tabular-nums transition-all ${localPitch === 0 ? 'text-slate-300' : 'text-indigo-600 scale-110 shadow-indigo-50'}`}>
                         {localPitch > 0 ? '+' : ''}{localPitch.toFixed(1)}
                       </span>
                    </div>
                  </div>
                  <div className="px-1 py-2">
                    <input 
                      type="range" 
                      min="-1" 
                      max="1" 
                      step="0.1" 
                      value={localPitch} 
                      onChange={(e) => setLocalPitch(parseFloat(e.target.value))} 
                      className="w-full h-2.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-600 transition-all hover:bg-slate-300 shadow-inner" 
                    />
                    <div className="flex justify-between px-1 mt-2.5">
                       <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">Lower</span>
                       <span className="text-[9px] font-black text-indigo-300 uppercase tracking-tighter">Natural</span>
                       <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">Higher</span>
                    </div>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleGenerate} 
                className="w-full py-5 px-4 rounded-[2.5rem] font-black text-base flex items-center justify-center gap-3 transition-all shadow-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 hover:translate-y-[-2px] active:translate-y-[1px]"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-white/20 rounded-full animate-ping"></div>
                  <svg className="w-6 h-6 relative" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                </div>
                {t.generateBriefing}
              </button>
            </div>
          )}

          {summary.status === 'error' && renderError()}
          {renderLoadingProgress()}

          {summary.status === 'ready' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className={`p-5 rounded-3xl border relative group/summary transition-all ${isActivePlayback ? 'bg-indigo-50/50 border-indigo-200 shadow-lg shadow-indigo-100/50' : 'bg-slate-50 border-slate-100'}`}>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{localLanguage} {t.summary}</span>
                    <span className="w-1.5 h-1.5 bg-slate-200 rounded-full"></span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{localVoice} ({localPitch > 0 ? '+' : ''}{localPitch.toFixed(1)})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={handleCopy} className={`p-2 rounded-xl transition-all shadow-sm ${isCopied ? 'bg-green-500 text-white' : 'bg-white text-slate-400 hover:text-indigo-600 hover:scale-110 active:scale-95'}`} title={t.copy}>
                      {isCopied ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                      )}
                    </button>
                    <span className="text-[10px] font-black text-slate-400 uppercase bg-white px-3 py-1 rounded-xl shadow-sm border border-slate-100/50 tabular-nums">{getWordCount(summary.summaryText)} {t.words}</span>
                  </div>
                </div>
                <p className="text-base text-slate-700 italic leading-relaxed font-medium">"{summary.summaryText}"</p>
                
                <div className="mt-4 flex justify-end items-center gap-3">
                  <div className="flex gap-2 items-center">
                    {feedback && (
                      <span className="text-[10px] font-black text-indigo-500 italic animate-in slide-in-from-right-2 duration-500 uppercase tracking-widest">{t.feedbackThanks}</span>
                    )}
                    
                    <div className="flex items-center gap-2">
                      {feedback && (
                        <button 
                          onClick={clearFeedback}
                          className="p-2 bg-white text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 shadow-sm transition-all flex items-center gap-1.5 animate-in slide-in-from-right-2 duration-300"
                          title={t.undo}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                          <span className="text-[10px] font-black uppercase tracking-tighter">{t.undo}</span>
                        </button>
                      )}
                      
                      <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
                        <button 
                          onClick={() => handleFeedback('positive')} 
                          className={`p-2 rounded-xl transition-all ${feedback === 'positive' ? 'bg-indigo-600 text-white scale-110 shadow-lg shadow-indigo-100 rotate-[-4deg]' : 'text-slate-300 hover:text-indigo-500 hover:bg-slate-50'}`} 
                          title="Good summary"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                        </button>
                        <button 
                          onClick={() => handleFeedback('negative')} 
                          className={`p-2 rounded-xl transition-all ${feedback === 'negative' ? 'bg-orange-500 text-white scale-110 shadow-lg shadow-orange-100 rotate-[4deg]' : 'text-slate-300 hover:text-orange-500 hover:bg-slate-50'}`} 
                          title="Needs improvement"
                        >
                          <svg className="w-5 h-5 rotate-180" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5">
                  <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tabular-nums tracking-widest">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <div className="relative w-full h-2 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                    <div className="absolute left-0 top-0 h-full bg-indigo-500 transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(99,102,241,0.5)]" style={{ width: `${(currentTime / (duration || 1)) * 100}%` }} />
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4 px-2">
                  <div className="text-slate-400 scale-110">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                  </div>
                  <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="flex-1 h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-600 shadow-inner" />
                  <span className="text-xs font-black text-slate-500 w-10 text-right tabular-nums">{Math.round(volume * 100)}%</span>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button onClick={() => handleSkip(-15)} className="flex-1 py-4 px-2 bg-white text-slate-600 hover:bg-slate-100 rounded-2xl transition-all flex items-center justify-center gap-1 shadow-sm font-black text-xs border border-slate-100 active:scale-95" title={t.skipBackward}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12.5 15L7 11.5l5.5-3.5v7zM17 15l-5.5-3.5L17 8v7z" /></svg>
                      -15s
                    </button>
                    <button onClick={togglePlayback} className={`flex-[2.5] py-5 px-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95 ${isPlaying ? 'bg-red-500 text-white shadow-red-200' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-300'}`}>
                      {isPlaying ? (
                        <>
                          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                          {t.stop}
                        </>
                      ) : (
                        <>
                          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                          {t.play}
                        </>
                      )}
                    </button>
                    <button onClick={() => handleSkip(15)} className="flex-1 py-4 px-2 bg-white text-slate-600 hover:bg-slate-100 rounded-2xl transition-all flex items-center justify-center gap-1 shadow-sm font-black text-xs border border-slate-100 active:scale-95" title={t.skipForward}>
                      +15s
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11.5 15l5.5-3.5-5.5-3.5v7zM7 15l5.5-3.5L7 8v7z" /></svg>
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleReplay} className="flex-1 py-3.5 px-4 bg-white text-slate-500 hover:bg-slate-50 rounded-2xl transition-all flex items-center justify-center gap-2 border border-slate-200 shadow-sm text-xs font-black active:scale-95" title={t.replay}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      {t.replay}
                    </button>
                    <button onClick={handleDownload} className="px-5 bg-white text-slate-500 hover:bg-slate-50 rounded-2xl transition-all flex items-center justify-center border border-slate-200 shadow-sm active:scale-95" title={t.download}>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                  </div>
                  <button 
                    onClick={handleExportAudio} 
                    disabled={isExporting}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-98"
                  >
                    {isExporting ? (
                      <>
                        <div className="w-4 h-4 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
                        {t.exporting}
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" /></svg>
                        {t.exportAudio}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History Modal */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg max-h-[85vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            <div className="p-7 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h2 className="text-xl font-black text-slate-800 tracking-tight">{t.summaryHistory}</h2>
              </div>
              <div className="flex items-center gap-2">
                {article.summaryHistory && article.summaryHistory.length > 0 && (
                  <button 
                    onClick={handleClearHistory}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95"
                    title={t.clearHistory}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
                <button onClick={() => setIsHistoryOpen(false)} className="p-2 text-slate-400 hover:text-slate-800 transition-colors bg-white rounded-xl border border-slate-200 shadow-sm active:scale-95">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {!article.summaryHistory || article.summaryHistory.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">{t.noHistory}</p>
                </div>
              ) : (
                article.summaryHistory.map(entry => (
                  <div key={entry.id} className="p-5 bg-white border border-slate-100 rounded-[2rem] hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all group/item">
                    <div className="flex justify-between items-start mb-3">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-lg inline-block">{t.versionOn} {new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString()}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{entry.language} • {entry.voice} Voice (Pitch {entry.pitch > 0 ? '+' : ''}{entry.pitch.toFixed(1)})</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {entry.feedback && (
                           <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${entry.feedback === 'positive' ? 'text-indigo-500 bg-indigo-50' : 'text-orange-500 bg-orange-50'}`}>
                             <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                               {entry.feedback === 'positive' ? (
                                 <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                               ) : (
                                 <path className="rotate-180 origin-center" d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                               )}
                             </svg>
                           </div>
                        )}
                        <button 
                          onClick={() => handleRestore(entry)}
                          className="px-4 py-2 bg-slate-900 text-white text-[11px] font-black uppercase rounded-xl shadow-lg shadow-slate-200 hover:bg-indigo-600 transition-all active:scale-95"
                        >
                          {t.restore}
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 italic line-clamp-2 leading-relaxed font-medium bg-slate-50/50 p-3 rounded-2xl border border-slate-100">"{entry.summaryText}"</p>
                  </div>
                ))
              )}
            </div>
            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setIsHistoryOpen(false)}
                className="px-8 py-3.5 bg-white text-slate-700 font-black text-sm rounded-2xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-all active:scale-95"
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Text Modal Overlay */}
      {isFullTextOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-top-10 duration-500">
            <div className="p-8 sm:p-12 border-b border-slate-100 flex justify-between items-start shrink-0 bg-slate-50/50">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                  <span className="text-[11px] font-black text-indigo-500 uppercase tracking-widest">{article.source || 'News Feed'}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-800 leading-tight tracking-tight">{article.title}</h2>
              </div>
              <button 
                onClick={() => setIsFullTextOpen(false)}
                className="p-3 text-slate-400 hover:text-slate-800 transition-colors bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 shrink-0 ml-4"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 sm:p-12 text-slate-600 leading-relaxed text-base sm:text-lg space-y-6 font-medium whitespace-pre-wrap selection:bg-indigo-100 selection:text-indigo-900">
              {article.content}
            </div>

            <div className="p-8 sm:p-10 bg-slate-50/80 backdrop-blur-sm border-t border-slate-100 flex flex-wrap justify-end gap-4 shrink-0">
              <button 
                onClick={handleCopyFullContent}
                className={`px-8 py-4 rounded-[1.5rem] font-black text-sm transition-all flex items-center gap-2 shadow-xl active:scale-95 ${isContentCopied ? 'bg-green-500 text-white shadow-green-200' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-slate-100'}`}
              >
                {isContentCopied ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" d="M5 13l4 4L19 7" /></svg>
                    {t.contentCopied}
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 002 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    {t.copyContent}
                  </>
                )}
              </button>
              <button 
                onClick={() => setIsFullTextOpen(false)}
                className="px-10 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-sm shadow-2xl shadow-slate-200 hover:bg-slate-800 transition-all active:scale-95"
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleCard;
