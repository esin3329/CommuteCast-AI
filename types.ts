
export interface NewsArticle {
  id: string;
  title: string;
  content: string;
  source?: string;
  url?: string;
  currentSummary?: SummaryHistoryEntry;
  summaryHistory?: SummaryHistoryEntry[];
}

export interface SummaryHistoryEntry {
  id: string;
  summaryText: string;
  audioBlob?: string; // Base64 PCM data
  voice: VoiceName;
  language: Language;
  pitch: number;
  timestamp: number;
  feedback?: 'positive' | 'negative';
  starRating?: number;
}

export interface AudioSummary {
  articleId: string;
  summaryText: string;
  audioBlob?: string; // Base64 PCM data
  status: 'idle' | 'summarizing' | 'generating-audio' | 'ready' | 'error';
  error?: string;
}

export enum VoiceName {
  Kore = 'Kore',
  Puck = 'Puck',
  Charon = 'Charon',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr'
}

export enum Language {
  English = 'English',
  Korean = 'Korean',
  Japanese = 'Japanese',
  Chinese = 'Chinese',
  Spanish = 'Spanish',
  French = 'French',
  German = 'German'
}
