/// <reference types="vite/client" />

interface Window {
    OneSignalDeferred?: Array<(...args: any[]) => void>;
    OneSignal?: any;
  }