// Tiny shared lock so a scan-capturing modal (e.g. WHS In/Out) can suppress the
// app-wide GlobalScanListener while it's open — otherwise a single barcode scan
// would fire in both places.
let count = 0;
export const scanLock = {
  acquire() { count++; },
  release() { count = Math.max(0, count - 1); },
  get active() { return count > 0; },
};
