/* @capacitor-community/text-to-speech shim — falls back to the browser's speechSynthesis when present. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const TextToSpeech: any = {
  speak: async (o: { text?: string; lang?: string; rate?: number; pitch?: number; volume?: number }) => {
    try { if (typeof speechSynthesis !== 'undefined' && o?.text) { const u = new SpeechSynthesisUtterance(o.text); if (o.lang) u.lang = o.lang; if (o.rate) u.rate = o.rate; speechSynthesis.speak(u) } } catch { /* ignore */ }
  },
  stop: async () => { try { speechSynthesis?.cancel() } catch { /* ignore */ } },
  getSupportedLanguages: async () => ({ languages: ['en-US'] }),
  getSupportedVoices: async () => ({ voices: [] }),
  isLanguageSupported: async () => ({ supported: true }),
  openInstall: async () => {},
}
