/* Furniture stock photography for the demo data (Unsplash, hot-linked under the Unsplash licence).
   None of these are Pan Furniture's own product photos — they only give every dummy row a picture. */
const U = (id: string, w = 640, h = 480) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&q=70&auto=format&fit=crop`

/** one hero photo per demo SKU */
export const PRODUCT_IMAGE: Record<string, string> = {
  'SF-VLV-3S': U('1555041469-a586c61ea9bc'),   // green velvet 3-seater
  'SF-LSH-GL': U('1583847268964-b28dc8f51f92'),   // grey linen sectional
  'BD-QN-NAR': U('1505693416388-ac5ce068fe85'),   // upholstered queen bed
  'BD-BNK-PN': U('1571508601891-ca5e7a713859'),   // bedroom, wooden bed
  'DN-6S-ACA': U('1617806118233-18e1de247200'),   // dining table + chairs
  'WD-3D-WHT': U('1513694203232-719a280e022f'),   // white drawer cabinet
  'KC-RUN-32': U('1588854337115-1c67d9247e4d'),   // white kitchen run
  'OF-TBL-WAL': U('1497215728101-856f4ea42174'),  // desk by the window
  'MT-6075-8': U('1615874959474-d609969a20ed'),   // made bed / mattress
  'CH-ACC-RTN': U('1567538096630-e0c55bd6374c'),  // cream accent chair
  'TB-CTR-MRB': U('1499933374294-4584851497cc'),  // round white side table
  'TV-CON-18': U('1594026112284-02bb6f3352fe'),   // floating TV console
  'SH-5T-OAK': U('1595428774223-ef52624120d2'),   // tall wooden shelf
  'OF-DSK-HT': U('1533090161767-e6ffed986c88'),   // small desk + lamp
  'CH-BAR-4': U('1581539250439-c96689b516dd'),    // black bar stool
}

/** extra angles per SKU (product gallery) */
export const PRODUCT_GALLERY: Record<string, string[]> = {
  'SF-VLV-3S': [U('1540574163026-643ea20ade25'), U('1549187774-b4e9b0445b41')],
  'SF-LSH-GL': [U('1493663284031-b7e3aefcae8e'), U('1616486338812-3dadae4b4ace')],
  'BD-QN-NAR': [U('1616594039964-ae9021a400a0')],
  'CH-ACC-RTN': [U('1586023492125-27b2c045efd7'), U('1550226891-ef816aed4a98'), U('1611967164521-abae8fba4668')],
  'CH-BAR-4': [U('1503602642458-232111445657')],
  'KC-RUN-32': [U('1600607686527-6fb886090705')],
  'OF-TBL-WAL': [U('1524758631624-e2822e304c36'), U('1612372606404-0ab33e7187ee')],
  'DN-6S-ACA': [U('1598300042247-d088f8ab3a91')],
}

/** room / site photos — delivery proof, installation, QC, returns */
export const ROOM_PHOTOS = [
  U('1631679706909-1844bbd07221'), U('1616486338812-3dadae4b4ace'), U('1556228453-efd6c1ff04f6'), U('1560448204-e02f11c3d0e2'),
  U('1600210492486-724fe5c67fb0'), U('1522708323590-d24dbb6b0267'), U('1538688525198-9b88f6f53126'), U('1493809842364-78817add7ffb'),
  U('1540574163026-643ea20ade25'), U('1549187774-b4e9b0445b41'), U('1618220179428-22790b461013'), U('1524758631624-e2822e304c36'),
]

/** imported PO line photos (chairs / tables that come in by container) */
export const IMPORT_PHOTOS = [U('1592078615290-033ee584e267'), U('1598300042247-d088f8ab3a91'), U('1499933374294-4584851497cc'), U('1503602642458-232111445657'), U('1519947486511-46149fa0a254')]

/** fabric / finish swatch as an inline SVG (no photo needed) */
export function swatch(color: string, label = ''): string {
  const c = SWATCH_HEX[color.toLowerCase()] ?? hashHex(color)
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="12" fill="${c}"/><rect x="6" y="6" width="84" height="84" rx="9" fill="none" stroke="#00000022"/>${label ? `<text x="48" y="88" font-family="monospace" font-size="9" text-anchor="middle" fill="#ffffffcc">${label}</text>` : ''}</svg>`)
}
const SWATCH_HEX: Record<string, string> = { moss: '#3f6b4f', grey: '#8a8d90', gray: '#8a8d90', natural: '#c9a76b', walnut: '#5b3a29', white: '#f2efe9', oak: '#b8935a', black: '#1f1f1f', 'white marble': '#e9e6e0', 'moss velvet': '#3f6b4f', beige: '#d9c7a8', choco: '#4a3125', navy: '#22304a', teal: '#2f6f73', cream: '#f0e6d2', charcoal: '#3a3a3a', tan: '#c19a6b', olive: '#6b6b3a', blush: '#e8c4c0', sand: '#d8c3a5' }
function hashHex(s: string) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 35% 55%)` }

export const imageFor = (sku: string | null | undefined, fallback = 0) => (sku && PRODUCT_IMAGE[sku]) || ROOM_PHOTOS[fallback % ROOM_PHOTOS.length]
export const galleryFor = (sku: string) => [imageFor(sku), ...(PRODUCT_GALLERY[sku] ?? [])]
export const roomPhotos = (seed: number, n: number) => Array.from({ length: n }, (_, i) => ROOM_PHOTOS[(seed + i * 5) % ROOM_PHOTOS.length])

/** swap any image path in the copied website CMS JSON for a furniture photo / swatch */
const IMG_RE = /\.(jpe?g|png|webp|avif|gif)(\?.*)?$/i
export function replaceCmsImages<T>(value: T, seed = 0): T {
  let n = seed
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (!IMG_RE.test(v)) return v
      if (/swatch/i.test(v) || /swatch|fabric|color/i.test(key)) { const name = v.split('/').pop()?.replace(IMG_RE, '').replace(/[-_]/g, ' ') ?? 'swatch'; return swatch(name) }
      n += 1; return ALL_PHOTOS[n % ALL_PHOTOS.length]
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, k)]))
    return v
  }
  return walk(value, '') as T
}
export const ALL_PHOTOS = [...new Set([...Object.values(PRODUCT_IMAGE), ...Object.values(PRODUCT_GALLERY).flat(), ...ROOM_PHOTOS])]
