/* next/font/google shim: the faces are loaded by StoreApp (Google Fonts <link>); here we only hand back
   the CSS variable name the layout attaches, which the Tailwind config reads. */
type Opts = { subsets?: string[]; weight?: string | string[]; variable?: string; display?: string }
type Font = { className: string; variable: string; style: { fontFamily: string } }
const make = (family: string) => (opts: Opts = {}): Font => ({ className: '', variable: opts.variable ?? '', style: { fontFamily: family } })
export const Inter = make("'Inter', Helvetica, Arial, sans-serif")
export const Cormorant = make("'Cormorant Garamond', Georgia, serif")
export const Bricolage_Grotesque = make("'Bricolage Grotesque', 'Segoe UI', Helvetica, sans-serif")
