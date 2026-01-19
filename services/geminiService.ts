import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceName, Language } from "../types";

// Removed global API_KEY constant to adhere to guideline: use process.env.API_KEY directly.

/**
 * Summarizes news article content in a specific language, optimized for TTS.
 */
export const getSummarizedText = async (articleContent: string, targetLanguage: Language = Language.English): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Please provide a concise, engaging summary of the following news article in ${targetLanguage}, optimized for being read aloud (natural speech). 
    Make it sound like a radio news anchor briefing. Keep the summary between 60-100 words in length.
    
    Article: ${articleContent}`,
    config: {
      temperature: 0.7,
      topP: 0.9,
    }
  });
  
  return response.text || 'Failed to generate summary.';
};

/**
 * Generates audio data for a summary using Gemini TTS.
 */
export const generateSpeech = async (text: string, voice: VoiceName = VoiceName.Kore, pitch: number = 0): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read the following news brief in a professional reporter style: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
          pitch: pitch,
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('No audio data received from Gemini TTS.');
  }
  return base64Audio;
};

/**
 * Extracts headline and content from a URL using Search Grounding.
 * Note: Guidelines state response.text may not be JSON when using search tools.
 */
export const fetchArticleContentFromUrl = async (url: string): Promise<{ title: string; content: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Use a two-step approach or clear format parsing because Search Grounding 
  // output may not be valid JSON if used with responseMimeType.
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Please visit this URL and extract the main headline and full article content: ${url}. 
    Format your output exactly like this:
    HEADLINE: [The headline here]
    CONTENT: [The article body text here]`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text || '';
  
  // Extract URLs from groundingChunks as per MUST ALWAYS guideline
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (groundingChunks) {
    console.debug('Grounding Chunks:', groundingChunks);
  }

  const headlineMatch = text.match(/HEADLINE:\s*(.*)/i);
  const contentMatch = text.match(/CONTENT:\s*([\s\S]*)/i);

  const title = headlineMatch ? headlineMatch[1].trim() : "Unknown Headline";
  const content = contentMatch ? contentMatch[1].trim() : text.trim();

  if (!text) throw new Error("Could not extract content from URL.");
  
  return { title, content };
};