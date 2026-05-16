/**
 * 0xio Wallet SDK - Event System
 * Type-safe event emitter for wallet events
 */

import { WalletEvent, WalletEventType } from './types';

export type EventListener<T = any> = (event: WalletEvent<T>) => void;

export class EventEmitter {
  private listeners = new Map<WalletEventType, Set<EventListener>>();
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Add event listener
   */
  on<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    
    this.listeners.get(eventType)!.add(listener);
    
    if (this.debug) {
      // console.log(`[0xio SDK] Added listener for '${eventType}' event`);
    }
  }

  /**
   * Remove event listener
   */
  off<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    const eventListeners = this.listeners.get(eventType);
    if (eventListeners) {
      eventListeners.delete(listener);
      
      if (eventListeners.size === 0) {
        this.listeners.delete(eventType);
      }
      
      if (this.debug) {
        // console.log(`[0xio SDK] Removed listener for '${eventType}' event`);
      }
    }
  }

  /**
   * Add one-time event listener
   */
  once<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    const onceListener: EventListener<T> = (event) => {
      // Remove BEFORE calling so a throwing listener doesn't stay registered
      this.off(eventType, onceListener);
      listener(event);
    };

    this.on(eventType, onceListener);
  }

  /**
   * Emit event to all listeners
   */
  emit<T = any>(eventType: WalletEventType, data: T): void {
    const event: WalletEvent<T> = {
      type: eventType,
      data,
      timestamp: Date.now()
    };

    const eventListeners = this.listeners.get(eventType);
    if (eventListeners && eventListeners.size > 0) {
      if (this.debug) {
        // console.log(`[0xio SDK] Emitting '${eventType}' event to ${eventListeners.size} listeners`, data);
      }
      
      // Create a copy to avoid issues if listeners modify the set during iteration
      const listenersArray = Array.from(eventListeners);
      
      for (const listener of listenersArray) {
        try {
          listener(event);
        } catch (error) {
          // console.error(`[0xio SDK] Error in event listener for '${eventType}':`, error);
        }
      }
    } else if (this.debug) {
      // console.log(`[0xio SDK] No listeners for '${eventType}' event`);
    }
  }

  /**
   * Remove all listeners for a specific event type
   */
  removeAllListeners(eventType?: WalletEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
      if (this.debug) {
        // console.log(`[0xio SDK] Removed all listeners for '${eventType}' event`);
      }
    } else {
      this.listeners.clear();
      if (this.debug) {
        // console.log('[0xio SDK] Removed all event listeners');
      }
    }
  }

  /**
   * Get number of listeners for an event type
   */
  listenerCount(eventType: WalletEventType): number {
    const eventListeners = this.listeners.get(eventType);
    return eventListeners ? eventListeners.size : 0;
  }

  /**
   * Get all event types that have listeners
   */
  eventTypes(): WalletEventType[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Check if there are any listeners for an event type
   */
  hasListeners(eventType: WalletEventType): boolean {
    return this.listenerCount(eventType) > 0;
  }
}