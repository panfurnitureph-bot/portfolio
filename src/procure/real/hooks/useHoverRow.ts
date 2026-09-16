import { useEffect, useRef, useState } from "react";

/**
 * Tracks which table row is "settled" on for the hover-to-edit grid pattern.
 * Entering a row doesn't reveal its editable widgets immediately — only after
 * the mouse rests there for `delayMs` — so gliding or scanning down many rows
 * at a normal reading pace just shows the plain :hover background (no widget
 * swapping, no layout "ripple" from rows changing height one after another).
 * 350ms is deliberately generous — long enough that briefly passing over a
 * row while scanning the list never triggers it, short enough that a genuine
 * pause to edit still feels instant. Leaving a row clears immediately, no
 * exit lag.
 */
export function useHoverRow(delayMs = 350) {
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const onRowMouseEnter = (id: string) => {
    clearTimer();
    timerRef.current = setTimeout(() => setHoveredRowId(id), delayMs);
  };
  const onRowMouseLeave = (id: string) => {
    clearTimer();
    setHoveredRowId((cur) => (cur === id ? null : cur));
  };

  useEffect(() => clearTimer, []);

  return { hoveredRowId, onRowMouseEnter, onRowMouseLeave };
}

/**
 * Tracks which table row is "active" for the click-to-edit grid pattern —
 * real Airtable reveals a row's editable widgets on click, not on hover.
 * Clicking a row activates it (and implicitly deactivates whichever row was
 * active before, since only one can be active at a time); clicking anywhere
 * outside every row — another control, blank table space, elsewhere on the
 * page — deactivates it. Each `<tr>` using this must carry
 * `data-row-id={id}` so the outside-click check can identify it.
 */
export function useActiveRow() {
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  useEffect(() => {
    if (activeRowId == null) return;
    // mousedown (not click) so it resolves before the new target's own click
    // handler fires, matching the outside-click pattern already used by the
    // dropdown editors in EditableCell.tsx.
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.(`[data-row-id="${activeRowId}"]`)) setActiveRowId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeRowId]);

  return { activeRowId, setActiveRowId };
}
