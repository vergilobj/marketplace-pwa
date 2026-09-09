import type { BazarMessage } from '../api/bazar';

type Listener = () => void;

/**
 * Лёгкий модульный стор для чата Базара.
 * Оба экземпляра BazarChat (главная compact и /bazar full) читают один кэш,
 * поэтому история одна и та же, а welcome вызывается только когда истории нет.
 */
let messages: BazarMessage[] | null = null;
let loaded = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export const bazarStore = {
  getMessages(): BazarMessage[] | null {
    return messages;
  },
  isLoaded(): boolean {
    return loaded;
  },
  setMessages(msgs: BazarMessage[]) {
    messages = msgs;
    loaded = true;
    emit();
  },
  appendMessage(msg: BazarMessage) {
    messages = messages === null ? [msg] : [...messages, msg];
    loaded = true;
    emit();
  },
  clearMessages() {
    messages = [];
    loaded = false;
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};