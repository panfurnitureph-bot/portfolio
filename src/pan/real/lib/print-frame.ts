// PRINT SA HIDDEN IFRAME, HINDI SA POPUP (2026-09-07). Ang `window.open("")`
// ay nagbubukas ng about:blank — sa desktop app (pan-system-desktop) ang
// window-open handler ay ipinapasa ang bawat hindi-IMS na URL sa Windows, kaya
// "Get an app to open this 'about' link" ang lumalabas at walang naipi-print.
// Ang iframe ay nasa loob ng parehong pahina: walang popup blocker, walang
// shell handler, gumagana sa browser at sa desktop app.
export function printHtml(html: string): void {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const doc = f.contentDocument ?? f.contentWindow?.document;
  const w = f.contentWindow;
  if (!doc || !w) { f.remove(); return; }
  let removed = false;
  const done = () => { if (removed) return; removed = true; setTimeout(() => f.remove(), 500); };
  doc.open();
  doc.write(html);
  doc.close();
  w.onafterprint = done;
  // Hintayin ang layout/fonts bago tawagin ang print dialog.
  setTimeout(() => {
    try { w.focus(); w.print(); } catch { done(); }
  }, 150);
  // Kung walang afterprint (ilang WebView), linisin pagkalipas ng isang minuto.
  setTimeout(done, 60_000);
}
