/* Demo product images for the motor-parts catalogue: inline SVG "part cards" (no real photos, no client assets). */
const PARTS: [string, string, string][] = [
  ['Brake', '#b91c1c', 'M20 32a12 12 0 1 0 24 0a12 12 0 1 0-24 0zm12-6v12M26 32h12'],
  ['Filter', '#0f766e', 'M20 20h24v6l-8 8v12l-8 4V34l-8-8z'],
  ['Spark', '#ca8a04', 'M32 16v10M26 26h12v6h-12zM32 32v6l-4 6h8l-4-6'],
  ['Shock', '#1d4ed8', 'M32 14v8M26 22h12v6H26zM28 28v18h8V28M24 46h16'],
  ['Light', '#7c3aed', 'M22 32a10 10 0 1 1 20 0v6H22zM26 44h12M28 48h8'],
  ['Chain', '#334155', 'M20 32h6M30 32h4M38 32h6M23 26a6 6 0 1 0 0 12M41 26a6 6 0 1 1 0 12'],
  ['Cooling', '#0369a1', 'M22 20h20v24H22zM26 24v16M32 24v16M38 24v16'],
  ['Battery', '#15803d', 'M20 24h24v20H20zM28 20h8v4h-8zM26 34h6M38 34h-6M35 31v6'],
  ['Mirror', '#6d28d9', 'M20 30a12 8 0 1 0 24 0a12 8 0 1 0-24 0zM32 38v8M26 46h12'],
  ['Belt', '#9a3412', 'M22 24h20a6 6 0 0 1 0 12H22a6 6 0 0 1 0-12zM32 36v8'],
  ['Bearing', '#475569', 'M32 32m-12 0a12 12 0 1 0 24 0a12 12 0 1 0-24 0M32 32m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0'],
  ['Pump', '#be185d', 'M22 22h16v20H22zM38 28h6v8h-6M26 42v4h8v-4'],
]
const svg = ([label, color, path]: [string, string, string]) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#f1f5f9"/><rect x="4" y="4" width="56" height="56" rx="6" fill="#ffffff" stroke="#e2e8f0"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="32" y="58" text-anchor="middle" font-family="Arial" font-size="7" fill="#64748b">${label}</text></svg>`)
export const PART_PHOTOS: string[] = PARTS.map(svg)
