import { WalletEvent, WalletEventType } from './types';

export type EventListener<T = any> = (event: WalletEvent<T>) => void;

export class EventEmitter {
  private listeners = new Map<WalletEventType, Set<EventListener>>();

  constructor(_debug = false) {}

  on<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
  }

  off<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    const eventListeners = this.listeners.get(eventType);
    if (eventListeners) {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  once<T = any>(eventType: WalletEventType, listener: EventListener<T>): void {
    const onceListener: EventListener<T> = (event) => {
      // Removed first so a throwing listener does not stay registered
      this.off(eventType, onceListener);
      listener(event);
    };

    this.on(eventType, onceListener);
  }

  emit<T = any>(eventType: WalletEventType, data: T): void {
    const event: WalletEvent<T> = {
      type: eventType,
      data,
      timestamp: Date.now()
    };

    const eventListeners = this.listeners.get(eventType);
    if (eventListeners && eventListeners.size > 0) {
      for (const listener of Array.from(eventListeners)) {
        try {
          listener(event);
        } catch {
          // a throwing listener must not stop the others
        }
      }
    }
  }

  removeAllListeners(eventType?: WalletEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(eventType: WalletEventType): number {
    const eventListeners = this.listeners.get(eventType);
    return eventListeners ? eventListeners.size : 0;
  }

  eventTypes(): WalletEventType[] {
    return Array.from(this.listeners.keys());
  }

  hasListeners(eventType: WalletEventType): boolean {
    return this.listenerCount(eventType) > 0;
  }
}