// JS side of the local "RidgelineAppleButton" plugin (ios/App/App/HikePlugin.swift): Apple's own system button, shown over the page.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Positions are PAGE coordinates (viewport position plus the page scroll); the native side converts them for safe areas and scrolling. */
export interface AppleButtonRect { token: string; x: number; y: number; width: number; height: number; dark: boolean }

export interface AppleButtonPlugin {
  /** Shows (or moves) the button for the instance that owns `token`. */
  show(rect: AppleButtonRect): Promise<void>;
  /** Hides the button, but only if `token` still owns it (a newer screen's button is left alone). */
  hide(opts: { token: string }): Promise<void>;
  addListener(event: 'tap', cb: (e: { token?: string }) => void): Promise<PluginListenerHandle>;
}

export const AppleButton = registerPlugin<AppleButtonPlugin>('RidgelineAppleButton');
