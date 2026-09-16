// NATIVE TEXT-TO-SPEECH PARA SA APK.
//
// BAKIT MAY FILE NA ITO: ang @capacitor-community/text-to-speech ay
// nagpaparehistro ng sarili sa `Capacitor.Plugins.TextToSpeech` — PERO SA
// SANDALING MA-IMPORT ANG PACKAGE. Walang nag-i-import nito kahit saan sa app,
// kaya hindi ito kailanman pumapasok sa bundle at `undefined` ang plugin sa
// APK. Ang turn-by-turn na boses ay tahimik na nahuhulog sa web
// speechSynthesis, na hindi maaasahan sa Android WebView — kaya WALANG TUNOG
// ang driver (naiulat 2026-08-22).
//
// Isang import dito ang nagpaparehistro nito para sa buong app.

import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { Capacitor } from "@capacitor/core";

export const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

// Ihanda ang engine bago pa ang unang liko. Sa Android, ang UNANG speak() ay
// naghihintay pang mag-init ng TTS engine — kadalasang nalalaktawan ang unang
// prompt. Isang tahimik na pagsasalita sa simula ang nag-aalis niyon.
export async function warmUpTts(): Promise<void> {
  if (!isNative()) return;
  try {
    await TextToSpeech.speak({ text: " ", lang: "en-US", rate: 1, pitch: 1, volume: 0 });
  } catch { /* walang engine sa device — ang web fallback ang bahala */ }
}

// ANG WEB SPEECH AY NANGANGAILANGAN NG GESTURE. Sa Windows app at sa desktop
// browser, ang unang speechSynthesis.speak() na walang naunang pindot ng tao ay
// tahimik na binabalewala — at dahil ang unang prompt ay awtomatikong pumuputok
// sa pagbukas ng mapa, walang naririnig ang lahat ng sumunod. Ang isang tahimik
// na utterance sa unang pindot kahit saan ang nagbubukas ng audio para sa buong
// pahina.
let webUnlocked = false;
export function unlockWebSpeech(): void {
  if (webUnlocked) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
    webUnlocked = true;
  } catch { /* walang web speech */ }
}
if (typeof window !== "undefined") {
  const arm = () => unlockWebSpeech();
  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
}

function webSpeak(text: string) {
  try {
    unlockWebSpeech();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.lang = "en-US";
    // Ang boses ay dumarating nang asynchronous sa Chrome; kapag wala pa,
    // ang default ang gamit — mas mabuti kaysa tahimik.
    try { const v = speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang)); if (v) u.voice = v; } catch { /* ignore */ }
    speechSynthesis.speak(u);
  } catch { /* walang web speech */ }
}

/**
 * Sabihin ang isang prompt ng nabigasyon. Native muna (APK), web ang fallback.
 * Ang naunang prompt ay pinuputol — ang bagong liko ang mahalaga, hindi ang luma.
 */
export async function speakNav(text: string): Promise<void> {
  const t = String(text || "").trim();
  if (!t) return;
  if (isNative()) {
    try {
      try { await TextToSpeech.stop(); } catch { /* walang tumutunog */ }
      await TextToSpeech.speak({ text: t, lang: "en-US", rate: 1, pitch: 1, volume: 1 });
      return;
    } catch { /* bumagsak ang native — subukan ang web */ }
  }
  webSpeak(t);
}

export async function stopNav(): Promise<void> {
  if (isNative()) { try { await TextToSpeech.stop(); } catch { /* ignore */ } }
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
}
