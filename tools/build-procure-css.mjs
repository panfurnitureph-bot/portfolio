/* Builds src/procure/procure.css: the Northwind Motor Parts stylesheet (Tailwind v3 + its index.css design tokens)
   compiled with every utility scoped under `.procure-root`, so it can coexist with the portfolio's and
   the Pan demo's CSS. Run after copying new files into src/procure/real (npm run procure:css). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from 'tailwindcss3'
import autoprefixer from 'autoprefixer'
import animate from 'tailwindcss-animate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const real = path.join(root, 'src/procure/real')
const SCOPE = '.procure-root'

const config = {
  important: SCOPE,
  corePlugins: { preflight: false },
  darkMode: ['class'],
  content: [path.join(real, '**/*.{ts,tsx}').replace(/\\/g, '/'), path.join(root, 'src/procure/*.tsx').replace(/\\/g, '/')],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: { sans: ['Manrope', 'system-ui', 'sans-serif'], display: ['Manrope', 'system-ui', 'sans-serif'], mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        /* Northwind hue remaps: the copied components use Tailwind's blue / slate / violet literals;
           re-pointing the scales moves every badge, chart and hover to the new identity without touching JSX. */
        blue: { 50: '#e9f5f5', 100: '#cfe9e9', 200: '#a5d6d6', 300: '#74bfbf', 400: '#43a3a5', 500: '#1f8a8c', 600: '#0f7173', 700: '#0d5b5d', 800: '#0c4849', 900: '#0a3a3b', 950: '#052324' },
        slate: { 50: '#f8f7f4', 100: '#f1efea', 200: '#e4e1da', 300: '#cfcbc2', 400: '#a39e94', 500: '#7a756c', 600: '#5c5850', 700: '#46433d', 800: '#2c2a26', 900: '#1c1b18', 950: '#121110' },
        violet: { 50: '#eef3f6', 100: '#d9e4ea', 200: '#b6cad6', 300: '#8dabbd', 400: '#6489a0', 500: '#4a6d84', 600: '#3b5769', 700: '#304654', 800: '#26363f', 900: '#1d2a31', 950: '#111a1f' },
        border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        chart: { primary: 'hsl(var(--chart-primary))', secondary: 'hsl(var(--chart-secondary))', tertiary: 'hsl(var(--chart-tertiary))', quaternary: 'hsl(var(--chart-quaternary))', muted: 'hsl(var(--chart-muted))' },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))', foreground: 'hsl(var(--sidebar-foreground))', primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))', accent: 'hsl(var(--sidebar-accent))', 'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))', ring: 'hsl(var(--sidebar-ring))', hover: 'hsl(var(--sidebar-hover))', active: 'hsl(var(--sidebar-active))',
          'active-bg': 'hsl(var(--sidebar-active-bg))', 'active-foreground': 'hsl(var(--sidebar-active-foreground))', muted: 'hsl(var(--sidebar-muted))',
          'muted-foreground': 'hsl(var(--sidebar-muted-foreground))', 'section-label': 'hsl(var(--sidebar-section-label))',
        },
        table: { row: 'hsl(var(--table-row))', 'row-alt': 'hsl(var(--table-row-alt))', 'row-hover': 'hsl(var(--table-row-hover))', border: 'hsl(var(--table-border))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: { card: 'var(--shadow-card)', enterprise: 'var(--shadow-lg)' },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(10px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'stagger-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'pulse-once': { '0%, 100%': { opacity: '1', transform: 'scale(1)' }, '50%': { opacity: '0.7', transform: 'scale(1.05)' } },
        'draw-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out', 'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out', 'slide-in-right': 'slide-in-right 0.3s ease-out', 'scale-in': 'scale-in 0.2s ease-out',
        'stagger-in': 'stagger-in 0.4s ease-out both', 'pulse-once': 'pulse-once 0.6s ease-out', 'draw-in': 'draw-in 0.8s ease-out',
      },
    },
  },
  plugins: [animate],
}

/* Source: the production index.css (tokens, base, components, utilities) + dashboard-enhancements.css. */
let src = fs.readFileSync(path.join(real, 'index.css'), 'utf8')
src = src.replace(/@import url\([^)]*\);\s*/g, '') // fonts are loaded by the portfolio shell
src += '\n' + fs.readFileSync(path.join(real, 'dashboard-enhancements.css'), 'utf8')

/* Scoped stand-in for Tailwind's preflight (only the bits the app relies on). */
const preflight = `
${SCOPE}, ${SCOPE} * , ${SCOPE} ::before, ${SCOPE} ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: hsl(var(--border)); }
${SCOPE} { line-height: 1.5; -webkit-text-size-adjust: 100%; font-family: 'Manrope', ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
${SCOPE} h1, ${SCOPE} h2, ${SCOPE} h3, ${SCOPE} h4, ${SCOPE} h5, ${SCOPE} h6, ${SCOPE} p, ${SCOPE} figure, ${SCOPE} blockquote, ${SCOPE} pre, ${SCOPE} dl, ${SCOPE} dd { margin: 0; }
${SCOPE} h1, ${SCOPE} h2, ${SCOPE} h3, ${SCOPE} h4, ${SCOPE} h5, ${SCOPE} h6 { font-size: inherit; font-weight: inherit; }
${SCOPE} ol, ${SCOPE} ul, ${SCOPE} menu { list-style: none; margin: 0; padding: 0; }
${SCOPE} img, ${SCOPE} svg, ${SCOPE} video, ${SCOPE} canvas, ${SCOPE} iframe { display: block; vertical-align: middle; }
${SCOPE} img, ${SCOPE} video { max-width: 100%; height: auto; }
${SCOPE} button, ${SCOPE} input, ${SCOPE} optgroup, ${SCOPE} select, ${SCOPE} textarea { font-family: inherit; font-size: 100%; font-weight: inherit; line-height: inherit; color: inherit; margin: 0; padding: 0; }
${SCOPE} button, ${SCOPE} [role="button"] { cursor: pointer; }
${SCOPE} button, ${SCOPE} select { text-transform: none; }
${SCOPE} button, ${SCOPE} [type='button'], ${SCOPE} [type='reset'], ${SCOPE} [type='submit'] { -webkit-appearance: button; background-color: transparent; background-image: none; }
${SCOPE} table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
${SCOPE} a { color: inherit; text-decoration: inherit; }
${SCOPE} hr { height: 0; color: inherit; border-top-width: 1px; }
${SCOPE} input::placeholder, ${SCOPE} textarea::placeholder { opacity: 1; color: hsl(var(--muted-foreground)); }
${SCOPE} :disabled { cursor: default; }
${SCOPE} [hidden] { display: none; }
${SCOPE} b, ${SCOPE} strong { font-weight: bolder; }
${SCOPE} code, ${SCOPE} kbd, ${SCOPE} samp, ${SCOPE} pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 1em; }
${SCOPE} small { font-size: 80%; }
${SCOPE} sub, ${SCOPE} sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }
${SCOPE} textarea { resize: vertical; }
${SCOPE} fieldset, ${SCOPE} legend { margin: 0; padding: 0; }
`

const input = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@layer base {\n${preflight}\n}\n` + src.replace(/@tailwind (base|components|utilities);\s*/g, '')

const out = await postcss([tailwind(config), autoprefixer]).process(input, { from: path.join(real, 'index.css'), to: path.join(root, 'src/procure/procure.css') })
let css = out.css
/* Scope the design tokens and the base rules that index.css put on :root / html / body / *. */
css = css
  .replace(/:root\s*,\s*\.light\b/g, SCOPE)
  .replace(/(^|[\s,}])(:root)\b/g, `$1${SCOPE}`)
  .replace(/(^|\})\s*html\s*,\s*body\s*\{/g, `$1 ${SCOPE} {`)
  .replace(/(^|\})\s*body\s*\{/g, `$1 ${SCOPE} {`)
  .replace(/(^|\})\s*html\s*\{/g, `$1 ${SCOPE} {`)
  .replace(/(^|\})\s*\*\s*\{/g, `$1 ${SCOPE} * {`)
  .replace(/(^|\})\s*\*\s*,\s*::before\s*,\s*::after\s*\{/g, `$1 ${SCOPE} *, ${SCOPE} ::before, ${SCOPE} ::after {`)
  .replace(/\.dark\s+(\.procure-root)/g, `${SCOPE}.dark`)
  .replace(/(^|[\s,}])(h1|h2|h3|h4|h5|h6)\s*(?=[,{])/g, (m, pre, tag) => `${pre}${SCOPE} ${tag} `)

const header = `/* GENERATED by tools/build-procure-css.mjs — do not edit. Northwind Motor Parts UI styles scoped to ${SCOPE}. */\n`
fs.writeFileSync(path.join(root, 'src/procure/procure.css'), header + css)
console.log('procure.css written:', (css.length / 1024).toFixed(0), 'KB')
