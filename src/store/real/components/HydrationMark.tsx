"use client";

import { useEffect } from "react";

// Nagtatakda ng window.__pan_hydrated kapag buhay na ang React. Binabasa ito ng
// boot script sa root layout: kung hindi ito lumitaw pagkatapos mag-load
// (nabitawan ng CDN ang isang chunk), isang reload ang gagawin.
export default function HydrationMark() {
  useEffect(() => {
    (window as unknown as { __pan_hydrated?: boolean }).__pan_hydrated = true;
    // CSS hook: habang wala ito, native scroll ang mga JS carousel (Rail).
    document.documentElement.setAttribute("data-hydrated", "1");
  }, []);
  return null;
}
