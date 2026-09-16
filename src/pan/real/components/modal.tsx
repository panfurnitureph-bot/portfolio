"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "./ui";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  brand,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
  // Opt-in na ENTERPRISE header band (espresso gradient + gold icon chip) —
  // kapareho ng ibang IMS card/table headers. `icon` = maikling label o node.
  brand?: { icon?: ReactNode };
}) {
  // Close on Escape + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl", "2xl": "sm:max-w-6xl", "3xl": "sm:max-w-7xl", full: "sm:max-w-[min(96vw,1680px)]" }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="pf-fade absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel — full-width bottom sheet on mobile, centered card on desktop */}
      <div
        className={cn(
          "pf-sheet sm:pf-modal relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl sm:max-h-[88vh] sm:rounded-2xl",
          sizeClass,
        )}
      >
        {/* Header — plain (default) o branded espresso band (brand prop) */}
        {brand ? (
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-5 py-3.5 sm:px-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#caa45a] text-xs font-extrabold text-[#3a2e14]">
              {brand.icon ?? title.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-extrabold tracking-wide text-[#f4ead8]">{title}</h2>
              {description && <p className="mt-0.5 truncate text-xs text-[#c9b896]">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#e7dcc4] transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-foreground"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="pf-scroll flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-border px-5 py-4 sm:px-6">{footer}</div>
        )}
      </div>
    </div>
  );
}
