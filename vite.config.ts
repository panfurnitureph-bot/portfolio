import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/')
const PAN_REAL = r('./src/pan/real/').replace(/\\/g, '/')
const PROCURE_REAL = r('./src/procure/real/').replace(/\\/g, '/')
const STORE_REAL = r('./src/store/real/').replace(/\\/g, '/')
const PROCURE_SHIMS: Record<string, string> = {
  'integrations/supabase/externalClient': r('./src/procure/shims/external-client.ts'),
  'integrations/supabase/client': r('./src/procure/shims/external-client.ts'),
  'contexts/AuthContext': r('./src/procure/shims/auth-context.tsx'),
  'components/shared/OrderDashboardTabs': r('./src/procure/shims/order-dashboard-tabs.tsx'),
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'process.env': { NEXT_PUBLIC_STORE_URL: 'https://panfurniture.ph', NEXT_PUBLIC_APP_URL: 'https://pan-furnitures.vercel.app', NEXT_PUBLIC_MAYA_PUBLIC_KEY: 'pk-demo-storefront' } },
  esbuild: { keepNames: true },
  resolve: {
    alias: [
      // Verbatim copies of the Pan-Furnitures source live under src/pan/real and keep their "@/…" imports.
      // "@/…" resolves per importer: files under src/procure (the Northwind Motor Parts copy) get src/procure/real, everything
      // else (the Pan copy) gets src/pan/real. A few console modules are swapped for demo shims.
      { find: /^@\//, replacement: r('./src/pan/real/'), customResolver(source, importer) {
        const imp = (importer ?? '').replace(/\\/g, '/')
        if (imp.includes('/src/store/')) return this.resolve(STORE_REAL + source.replace(/\\/g, '/').slice(PAN_REAL.length), importer, { skipSelf: true })
        if (!imp.includes('/src/procure/')) return this.resolve(source, importer, { skipSelf: true })
        const rest = source.replace(/\\/g, '/').slice(PAN_REAL.length)
        const shim = PROCURE_SHIMS[rest]
        if (shim) return shim
        return this.resolve(PROCURE_REAL + rest, importer, { skipSelf: true })
      } },
      // The console's pages import react-router-dom directly; under /procure they get a prefixing wrapper.
      { find: 'react-router-dom', replacement: 'react-router-dom', customResolver(_source, importer) {
        const imp = (importer ?? '').replace(/\\/g, '/')
        if (imp.includes('/src/procure/real/')) return r('./src/procure/shims/router.tsx')
        return null
      } },
      // Next.js runtime shims so the copied client components run inside this Vite SPA.
      // (the storefront copy under src/store has its own router, so its files get the store shims)
      { find: 'next/link', replacement: r('./src/pan/shims/next-link.tsx'), customResolver(source, importer) {
        const store = (importer ?? '').replace(/\\/g, '/').includes('/src/store/')
        return this.resolve(store ? r('./src/store/shims/next-link.tsx') : source, importer, { skipSelf: true })
      } },
      { find: 'next/navigation', replacement: r('./src/pan/shims/next-navigation.ts'), customResolver(source, importer) {
        const store = (importer ?? '').replace(/\\/g, '/').includes('/src/store/')
        return this.resolve(store ? r('./src/store/shims/next-navigation.ts') : source, importer, { skipSelf: true })
      } },
      { find: 'next/image', replacement: r('./src/store/shims/next-image.tsx') },
      { find: 'next/font/google', replacement: r('./src/store/shims/next-font-google.ts') },
      { find: 'next/dynamic', replacement: r('./src/pan/shims/next-dynamic.ts') },
      { find: 'next/cache', replacement: r('./src/pan/shims/next-cache.ts') },
      { find: 'server-only', replacement: r('./src/pan/shims/server-only.ts') },
      { find: 'next/server', replacement: r('./src/pan/shims/next-server.ts') },
      { find: 'next/headers', replacement: r('./src/pan/shims/next-headers.ts') },
      { find: '@imgly/background-removal', replacement: r('./src/pan/shims/imgly-bg.ts') },
      { find: '@vladmandic/face-api', replacement: r('./src/pan/shims/face-api.ts') },
      { find: 'sharp', replacement: r('./src/pan/shims/sharp.ts') },
      { find: '@capacitor/push-notifications', replacement: r('./src/pan/shims/capacitor-push.ts') },
      { find: '@capacitor-community/text-to-speech', replacement: r('./src/pan/shims/capacitor-tts.ts') },
      { find: '@capacitor/core', replacement: r('./src/pan/shims/capacitor-core.ts') },
      { find: /^pdfjs-dist(\/.*)?$/, replacement: r('./src/pan/shims/pdfjs.ts') },
      // Node built-ins referenced by copied server code (no-op / browser equivalents).
      { find: /^(node:)?crypto$/, replacement: r('./src/pan/shims/node-crypto.ts') },
      { find: /^(node:)?fs(\/promises)?$/, replacement: r('./src/pan/shims/node-fs.ts') },
      { find: /^(node:)?path$/, replacement: r('./src/pan/shims/node-path.ts') },
    ],
  },
  /* deps only reached through the lazy demo chunks — pre-bundle them up front so `vite dev` never re-optimises
     mid-session (that returns 504 "Outdated Optimize Dep" for buffer.js and blanks every demo until a restart) */
  /* The sibling source checkouts (Website/, Poly/) are gitignored inputs, not part of the app: keep the
     file watcher out of them — their build caches (.next/cache/*.pack) are locked and crash chokidar with EBUSY. */
  server: { watch: { ignored: ['**/Website/**', '**/Poly/**', '**/tools/assets/**'] } },
  optimizeDeps: {
    /* crawl the lazily loaded demo apps too, so every dependency is pre-bundled at startup */
    entries: ['index.html', 'src/pan/**/*.tsx', 'src/procure/**/*.tsx', 'src/store/**/*.tsx'],
    include: ["@radix-ui/react-alert-dialog", "@radix-ui/react-avatar", "@radix-ui/react-checkbox", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-hover-card", "@radix-ui/react-label", "@radix-ui/react-popover", "@radix-ui/react-scroll-area", "@radix-ui/react-select", "@radix-ui/react-separator", "@radix-ui/react-slot", "@radix-ui/react-switch", "@radix-ui/react-toggle", "@radix-ui/react-toggle-group", "@radix-ui/react-tooltip", "@splinetool/runtime", "@supabase/supabase-js", "@tanstack/react-query", "@tanstack/react-virtual", "@zxing/browser", "@zxing/library", "buffer", "class-variance-authority", "clsx", "cmdk", "date-fns", "exceljs", "file-saver", "html2canvas-pro", "jsbarcode", "jspdf", "jszip", "leaflet", "lucide-react", "motion", "pdfjs-dist", "qrcode", "react", "react-dom", "react-is", "react-router-dom", "recharts", "sonner", "tailwind-merge", "tesseract.js", "xlsx"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
