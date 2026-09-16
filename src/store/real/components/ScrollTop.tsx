"use client";

// Bilog na scroll-to-top button, lumalabas kapag naka-scroll pababa.

import { useEffect, useState } from "react";

export default function ScrollTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      data-floating
      className="fixed bottom-40 right-5 z-40 w-14 h-14 rounded-full bg-espresso text-cream shadow-lg flex items-center justify-center hover:bg-cognac transition-colors"
    >
      ↑
    </button>
  );
}
