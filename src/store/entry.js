// Plain JS on purpose: the root tsconfig excludes src/store (it has its own tsconfig.store.json), and a
// .js entry with a hand-written .d.ts keeps tsc from following the import into the copied storefront code.
export const loadStoreApp = () => import('./StoreApp')
