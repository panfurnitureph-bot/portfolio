// Plain JS on purpose: the root tsconfig excludes src/procure (it has its own tsconfig.procure.json), and a
// .js entry with a hand-written .d.ts keeps tsc from following the import into the copied console code.
export const loadProcureApp = () => import('./ProcureApp')
