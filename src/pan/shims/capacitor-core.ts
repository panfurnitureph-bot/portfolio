/* @capacitor/core shim — the portfolio runs in a plain browser, never inside the Android shell. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const Capacitor: any = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
  isPluginAvailable: (_n: string) => false,
  Plugins: {},
}
export const registerPlugin = (_name: string, impl?: any) => impl?.web ?? {}
