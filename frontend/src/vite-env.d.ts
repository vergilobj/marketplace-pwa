/// <reference types="vite/client" />

/**
 * OneSignal SDK подключается тегом в index.html, npm-пакета нет.
 * Держим структурный минимум: login/logout возвращают промис.
 */
interface OneSignalLike {
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface Window {
  OneSignalDeferred?: Array<(onesignal: OneSignalLike) => void>;
  OneSignal?: OneSignalLike;
}