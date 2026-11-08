// JS side of the local "RidgelineAppleButton" plugin (ios/App/App/HikePlugin.swift): Apple's own system button, shown over the page.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AppleButtonPlugin {
  show(rect: { x: number; y: number; width: number; height: number; dark: boolean }): Promise<void>;
  hide(): Promise<void>;
  addListener(event: 'tap', cb: () => void): Promise<PluginListenerHandle>;
}

export const AppleButton = registerPlugin<AppleButtonPlugin>('RidgelineAppleButton');
