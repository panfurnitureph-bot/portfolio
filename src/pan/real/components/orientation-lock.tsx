"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Orientation lock bawat ruta — para sa APK WebView (manifest = fullSensor, kaya
// ang runtime lock na ito ang nagdidikta):
//   • /attendance/kiosk → PORTRAIT (face oval + buttons sa baba ang disenyo)
//   • lahat ng iba      → LANDSCAPE (malalapad na tables ang mga screen)
// Sa desktop/mobile browser, ang screen.orientation.lock() ay nagre-reject
// (kailangan ng fullscreen) — nilulunok ang error, natural na rotation ang iiral.
export function OrientationLock() {
  const pathname = usePathname();

  useEffect(() => {
    type LockFn = (o: string) => Promise<void>;
    const so = (typeof screen !== "undefined" ? screen.orientation : null) as
      | (ScreenOrientation & { lock?: LockFn })
      | null;
    if (!so?.lock) return;
    const want = pathname.startsWith("/attendance/kiosk") ? "portrait" : "landscape";
    so.lock(want).catch(() => { /* browser na walang lock — hayaan */ });
  }, [pathname]);

  return null;
}
