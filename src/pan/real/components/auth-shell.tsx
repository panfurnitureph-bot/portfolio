"use client";

import { useState, type ReactNode } from "react";

// Centered auth layout (login / forgot / reset). Logo header + white card.
// Palette matches the PAN brand: olive-brown primary, gold accent, warm cream.
export function AuthShell({ children }: { children: ReactNode }) {
  const [logoOk, setLogoOk] = useState(true);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f5ef] px-4 py-10">
      <div className="mb-7 flex items-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#5b5026] ring-1 ring-[#c9a85c]/40">
          {logoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/logo.png"
              alt="Pan Furniture"
              className="h-16 w-16 object-cover"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="text-sm font-bold text-[#f6efda]">PAN</span>
          )}
        </span>
        <span className="text-2xl font-bold tracking-tight text-[#2a2519]">
          Pan Furniture
        </span>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-[#e7e0d2] bg-white p-7 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  );
}

// Shared field styles.
export const authInput =
  "w-full rounded-lg border border-[#e0d8c6] bg-white px-3.5 py-2.5 text-sm text-[#2a2519] outline-none transition-colors placeholder:text-[#a89f88] focus:border-[#c9a85c] focus:ring-2 focus:ring-[#c9a85c]/30";

export const authLabel = "mb-1.5 block text-sm font-semibold text-[#2a2519]";

// Primary brand button (olive-brown). Both names kept for the existing imports.
export const btnPrimary =
  "block w-full rounded-lg bg-[#5b5026] px-4 py-2.5 text-center text-sm font-semibold text-[#f6efda] transition-colors hover:bg-[#473f1e] disabled:cursor-not-allowed disabled:opacity-50";

export const btnNavy = btnPrimary;
