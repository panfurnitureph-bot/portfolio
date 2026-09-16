"use client";

// Naglalagay ng data-apk="1" sa <html> kapag tumatakbo sa loob ng Capacitor APK
// (native Android app). Ginagamit ng CSS para itago ang ilang bagay na para sa
// desktop lang (hal. summary stat cards) — kahit gaano kaluwang ang device.
//
// Dalawang senyales, alinman ay sapat:
//   1. Capacitor.isNativePlatform() — ang tunay na native bridge.
//   2. Ang UA tag na "PANFurniturePH/<version>" na idinaragdag ng APK build.

import { useEffect } from "react";

export default function ApkFlag() {
  useEffect(() => {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    const native = !!w.Capacitor?.isNativePlatform?.();
    const uaApk = /PANFurniturePH\/\d+/.test(navigator.userAgent || "");
    if (native || uaApk) {
      document.documentElement.setAttribute("data-apk", "1");
    }
  }, []);

  return null;
}
