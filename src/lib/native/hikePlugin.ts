// JS side of the local "RidgelineHike" Capacitor plugin (android/ HikePlugin.java, ios/ HikePlugin.swift).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Fix } from '../gps/source';

export interface NavNotification {
  /** Big line: the next instruction, e.g. "Stay left for Mount Si Trail". */
  title: string;
  /** Second line: e.g. "In 500 ft · 2.1 mi left · 63% done". */
  text: string;
  /** 0-100. Shown as a bar on Android; on iOS it is part of the text. */
  progress?: number;
}

export type NativeFix = Fix;

export type PermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
export interface HikePermissions { location: PermissionState; notifications: PermissionState }

export interface HikePlugin {
  checkPermissions(): Promise<HikePermissions>;
  requestPermissions(): Promise<HikePermissions>;
  /** Starts position updates (and the Android foreground service) for a hike the user started. */
  startHike(opts: NavNotification): Promise<void>;
  /** Stops position updates and removes the notification. */
  stopHike(): Promise<void>;
  updateNotification(opts: NavNotification): Promise<void>;
  addListener(event: 'fix', cb: (fix: NativeFix) => void): Promise<PluginListenerHandle>;
  addListener(event: 'locationError', cb: (e: { code: number; message: string }) => void): Promise<PluginListenerHandle>;
}

export const RidgelineHike = registerPlugin<HikePlugin>('RidgelineHike');
