import { Capacitor } from '@capacitor/core';

/** True inside the iOS or Android app (Capacitor), false in a browser or the PWA. */
export const isNative = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): 'ios' | 'android' | 'web' => Capacitor.getPlatform() as 'ios' | 'android' | 'web';
