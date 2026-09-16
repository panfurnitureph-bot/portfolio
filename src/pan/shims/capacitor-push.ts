/* @capacitor/push-notifications shim — native push is only available inside the Android shell. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const PushNotifications: any = {
  checkPermissions: async () => ({ receive: 'denied' }),
  requestPermissions: async () => ({ receive: 'denied' }),
  register: async () => {},
  addListener: async (_evt: string, _cb: (t: any) => void) => { void _evt; void _cb; return { remove: async () => {} } },
  removeAllListeners: async () => {},
  getDeliveredNotifications: async () => ({ notifications: [] }),
}
export type Token = { value: string }
export type PushNotificationSchema = any
export type ActionPerformed = any
