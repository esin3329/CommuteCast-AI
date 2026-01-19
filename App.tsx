
import React, { useState, useCallback, useEffect } from 'react';
import { NewsArticle, VoiceName, Language } from './types.ts';
import ArticleCard from './components/ArticleCard.tsx';
import { fetchArticleContentFromUrl } from './services/geminiService.ts';
import { translations } from './translations.ts';

const TRUSTED_NEWS_DOMAINS = [
  'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'reuters.com', 
  'cnn.com', 'aljazeera.com', 'wired.com', 'theverge.com', 'techcrunch.com', 
  'bloomberg.com', 'wsj.com', 'forbes.com', 'npr.org', 'apnews.com', 
  'axios.com', 'theatlantic.com', 'vox.com', 'politico.com', 'nbcnews.com',
  'foxnews.com', 'thehill.com', 'time.com', 'nature.com', 'economist.com'
];

const App: React.FC = () => {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [savedArticles, setSavedArticles] = useState<NewsArticle[]>([]);
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('queue');
  const [activePlaybackId, setActivePlaybackId] = useState<string | null>(null);
  
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Kore);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.English);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const getInitialTheme = (): 'light' | 'dark' => {
    if (typeof window === 'undefined') return 'light';
    const storedTheme = localStorage.getItem('commutecast_theme');
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  // Drag and Drop state
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const t = translations[selectedLanguage];

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('commutecast_theme', theme);
  }, [theme]);

  // Load from localStorage on mount
  useEffect(() => {
    const storedQueue = localStorage.getItem('commute_queue');
    const storedLibrary = localStorage.getItem('commute_library');
    if (storedQueue) setArticles(JSON.parse(storedQueue));
    if (storedLibrary) setSavedArticles(JSON.parse(storedLibrary));
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('commute_queue', JSON.stringify(articles));
  }, [articles]);

  useEffect(() => {
    localStorage.setItem('commute_library', JSON.stringify(savedArticles));
  }, [savedArticles]);

  const verifyUrlLegitimacy = (url: string): { valid: boolean, warning?: string } => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, warning: t.invalidUrl };
      }
      
      const domain = parsed.hostname.replace('www.', '');
      const isKnownSource = TRUSTED_NEWS_DOMAINS.some(d => domain.endsWith(d));
      
      const pathLooksLikeArticle = /\/\d{4}\/|\/(article|news|story|content|post)\/|[\w-]{15,}/i.test(parsed.pathname);

      if (!isKnownSource && !pathLooksLikeArticle) {
        return { valid: true, warning: t.unsupportedDomain };
      }

      return { valid: true };
    } catch (e) {
      return { valid: false, warning: t.invalidUrl };
    }
  };

  const handleFetchFromUrl = async () => {
    if (!newUrl.trim()) return;
    
    setFetchError(null);
    const verification = verifyUrlLegitimacy(newUrl);
    
    if (!verification.valid) {
      setFetchError(verification.warning || t.invalidUrl);
      return;
    }

    if (verification.warning) {
      setFetchError(verification.warning);
    }

    setIsFetching(true);
    try {
      const { title, content } = await fetchArticleContentFromUrl(newUrl);
      setNewTitle(title);
      setNewContent(content);
      if (!newSource) {
        try {
          const domain = new URL(newUrl).hostname.replace('www.', '');
          setNewSource(domain);
        } catch (e) {}
      }
      setFetchError(null);
    } catch (err: any) {
      setFetchError(t.fetchError);
      console.error(err);
    } finally {
      setIsFetching(false);
    }
  };

  const addArticle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    
    const article: NewsArticle = {
      id: Math.random().toString(36).substr(2, 9),
      title: newTitle,
      content: newContent,
      source: newSource || 'General News',
      url: newUrl || undefined,
      summaryHistory: [],
    };

    setArticles(prev => [article, ...prev]);
    setNewTitle('');
    setNewContent('');
    setNewSource('');
    setNewUrl('');
    setShowAddForm(false);
    setActiveTab('queue');
  };

  const removeArticle = useCallback((id: string) => {
    setArticles(prev => prev.filter(a => a.id !== id));
    if (activePlaybackId === id) setActivePlaybackId(null);
  }, [activePlaybackId]);

  const removeSavedArticle = useCallback((id: string) => {
    setSavedArticles(prev => prev.filter(a => a.id !== id));
    if (activePlaybackId === id) setActivePlaybackId(null);
  }, [activePlaybackId]);

  const toggleSaveForLater = (article: NewsArticle) => {
    const alreadySaved = savedArticles.some(a => a.id === article.id || a.url === article.url);
    if (alreadySaved) {
      setSavedArticles(prev => prev.filter(a => (a.id !== article.id && a.url !== article.url)));
    } else {
      setSavedArticles(prev => [article, ...prev]);
    }
  };

  const handleUpdateArticle = useCallback((updatedArticle: NewsArticle) => {
    setArticles(prev => prev.map(a => a.id === updatedArticle.id ? updatedArticle : a));
    setSavedArticles(prev => prev.map(a => a.id === updatedArticle.id ? updatedArticle : a));
  }, []);

  const handlePlaybackFinished = useCallback((id: string) => {
    if (activeTab !== 'queue') {
      setActivePlaybackId(null);
      return;
    }

    const index = articles.findIndex(a => a.id === id);
    if (index !== -1 && index < articles.length - 1) {
      const nextArticle = articles[index + 1];
      if (nextArticle.currentSummary?.audioBlob) {
        setActivePlaybackId(nextArticle.id);
      } else {
        setActivePlaybackId(null);
      }
    } else {
      setActivePlaybackId(null);
    }
  }, [articles, activeTab]);

  const handlePlaybackStarted = useCallback((id: string) => {
    setActivePlaybackId(id);
  }, []);

  const handlePlaybackStopped = useCallback((id: string) => {
    if (activePlaybackId === id) {
      setActivePlaybackId(null);
    }
  }, [activePlaybackId]);

  const onDragStart = (e: React.DragEvent, index: number) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
        const target = e.target as HTMLElement;
        if (target) target.classList.add('opacity-40', 'scale-95');
    }, 0);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const onDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    if (target) target.classList.remove('opacity-40', 'scale-95');
    setDraggedItemIndex(null);
    setDragOverIndex(null);
  };

  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index) return;

    const newArticles = [...articles];
    const [reorderedItem] = newArticles.splice(draggedItemIndex, 1);
    newArticles.splice(index, 0, reorderedItem);

    setArticles(newArticles);
    setDraggedItemIndex(null);
    setDragOverIndex(null);
  };

  const currentList = activeTab === 'queue' ? articles : savedArticles;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 dark:bg-slate-950/80 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 rotate-3">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent">
                {t.appName}
              </h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest dark:text-slate-400">{t.tagline}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 p-1 rounded-xl dark:bg-slate-800">
              <button 
                onClick={() => { setActiveTab('queue'); setActivePlaybackId(null); }}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all ${activeTab === 'queue' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900' : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {t.yourQueue}
              </button>
              <button 
                onClick={() => { setActiveTab('library'); setActivePlaybackId(null); }}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all ${activeTab === 'library' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900' : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {t.library}
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <select 
                value={selectedLanguage} 
                onChange={(e) => setSelectedLanguage(e.target.value as Language)}
                className="text-xs font-bold bg-slate-100 border-none rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 cursor-pointer appearance-none text-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                {Object.values(Language).map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors flex items-center justify-center dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              type="button"
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0-1.414 1.414M7.05 16.95l-1.414 1.414M12 7a5 5 0 100 10 5 5 0 000-10z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 mt-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight dark:text-slate-100">
              {activeTab === 'queue' ? t.yourQueue : t.library}
            </h2>
            <p className="text-sm text-slate-400 font-medium dark:text-slate-400">
              {activeTab === 'queue' ? t.queueSub : `${savedArticles.length} ${t.saved}`}
            </p>
          </div>
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className={`px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg ${showAddForm ? 'bg-red-50 text-red-500 shadow-red-100 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white'}`}
          >
            {showAddForm ? t.close : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                {t.addStory}
              </>
            )}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={addArticle} className="bg-white p-8 rounded-3xl shadow-2xl border border-indigo-50 mb-10 animate-in zoom-in-95 duration-300 relative overflow-hidden dark:bg-slate-900 dark:border-slate-800">
            {isFetching && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center animate-in fade-in duration-300 dark:bg-slate-900/70">
                <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                <p className="text-indigo-600 font-black text-xs uppercase tracking-widest animate-pulse">Extracting Story...</p>
              </div>
            )}
            
            <div className={`space-y-6 transition-all duration-500 ${isFetching ? 'blur-[2px] opacity-60' : ''}`}>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t.importUrl}</label>
                <div className="flex gap-3">
                  <input 
                    type="url" 
                    value={newUrl}
                    onChange={(e) => {
                      setNewUrl(e.target.value);
                      if (fetchError) setFetchError(null);
                    }}
                    placeholder={t.placeholderUrl}
                    className="flex-1 px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all text-sm font-medium dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100"
                    disabled={isFetching}
                  />
                  <button
                    type="button"
                    onClick={handleFetchFromUrl}
                    disabled={isFetching || !newUrl}
                    className="px-6 py-4 bg-indigo-50 text-indigo-600 font-black rounded-2xl hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 text-sm shadow-sm"
                  >
                    {isFetching ? (
                      <div className="w-5 h-5 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin"></div>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    )}
                    {t.magicFetch}
                  </button>
                </div>
                {fetchError && (
                  <div className={`mt-2 flex items-start gap-2 p-3 rounded-xl border animate-in slide-in-from-top-1 ${fetchError === t.unsupportedDomain ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-red-50 border-red-100 text-red-600'}`}>
                    <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <p className="text-[11px] font-bold leading-tight">{fetchError}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t.headline}</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t.placeholderTitle}
                    className={`w-full px-5 py-4 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium ${isFetching ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-50 focus:bg-white dark:bg-slate-950 dark:focus:bg-slate-900'} dark:border-slate-800 dark:text-slate-100`}
                    required
                    disabled={isFetching}
                  />
                    {isFetching && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.5s_infinite] rounded-2xl"></div>}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t.sourceLabel}</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      placeholder={t.placeholderSource}
                    className={`w-full px-5 py-4 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium ${isFetching ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-50 focus:bg-white dark:bg-slate-950 dark:focus:bg-slate-900'} dark:border-slate-800 dark:text-slate-100`}
                    disabled={isFetching}
                  />
                    {isFetching && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.5s_infinite] rounded-2xl"></div>}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2 ml-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.articleBody}</label>
                  <span className={`text-[10px] font-bold ${newContent.length > 4500 ? 'text-orange-500' : 'text-slate-400'}`}>
                    {newContent.length.toLocaleString()} {t.characters}
                  </span>
                </div>
                <div className="relative">
                  <textarea 
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder={t.placeholderContent}
                    className={`w-full px-5 py-4 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-40 resize-none text-sm font-medium leading-relaxed ${isFetching ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-50 focus:bg-white dark:bg-slate-950 dark:focus:bg-slate-900'} dark:border-slate-800 dark:text-slate-100`}
                    required
                    disabled={isFetching}
                  />
                  {isFetching && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.5s_infinite] rounded-2xl"></div>}
                </div>
              </div>

              <button 
                type="submit"
                disabled={isFetching}
                className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50 text-base"
              >
                {t.addToBriefing}
              </button>
            </div>
          </form>
        )}

        {currentList.length === 0 ? (
          <div className="text-center py-32 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:bg-slate-900 dark:border-slate-800">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-6 group hover:rotate-0 transition-transform duration-500 dark:bg-slate-800">
              <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            </div>
            <h3 className="text-xl font-black text-slate-600 tracking-tight dark:text-slate-200">
              {activeTab === 'queue' ? t.emptyQueue : t.emptyLibrary}
            </h3>
            <p className="text-slate-400 max-w-xs mx-auto mt-2 font-medium dark:text-slate-400">
              {activeTab === 'queue' ? t.emptyQueueSub : t.emptyLibrarySub}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative">
            {currentList.map((article, index) => {
              const isDragged = draggedItemIndex === index;
              const isOver = dragOverIndex === index && draggedItemIndex !== index;
              
              return (
                <div
                  key={article.id}
                  draggable={activeTab === 'queue'}
                  onDragStart={(e) => onDragStart(e, index)}
                  onDragOver={(e) => onDragOver(e, index)}
                  onDrop={(e) => onDrop(e, index)}
                  onDragEnd={onDragEnd}
                  className={`transition-all duration-200 relative group/drag ${
                    isOver ? 'scale-[1.03] -translate-y-2' : ''
                  }`}
                >
                  {isOver && (
                    <div className="absolute -inset-2 rounded-[2.5rem] bg-indigo-50 border-2 border-indigo-200 animate-pulse -z-10"></div>
                  )}
                  <ArticleCard 
                    article={article} 
                    onRemove={activeTab === 'queue' ? removeArticle : removeSavedArticle}
                    onSave={toggleSaveForLater}
                    onUpdateArticle={handleUpdateArticle}
                    onStarted={handlePlaybackStarted}
                    onStopped={handlePlaybackStopped}
                    onFinished={handlePlaybackFinished}
                    isActivePlayback={activePlaybackId === article.id}
                    isSaved={savedArticles.some(a => a.id === article.id || a.url === article.url)}
                    voice={selectedVoice}
                    language={selectedLanguage}
                    isDraggable={activeTab === 'queue'}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>

      {articles.length > 0 && activeTab === 'queue' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-slate-900 text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border border-white/5 animate-in fade-in slide-in-from-bottom-8 duration-500">
            <div className="relative">
              <div className="w-3 h-3 bg-indigo-500 rounded-full animate-ping absolute inset-0"></div>
              <div className="w-3 h-3 bg-indigo-500 rounded-full relative"></div>
            </div>
            <span className="text-sm font-black uppercase tracking-widest">{t.commuteReady}</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default App;
