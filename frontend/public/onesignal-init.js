// OneSignal init — вынесен из index.html в отдельный файл.
//
// Раньше этот код был инлайновым <script> в index.html и ломался о CSP
// (`script-src 'self' https://cdn.onesignal.com https://onesignal.com`) —
// ошибка «Executing inline script violates the following Content Security
// Policy directive» висела в консоли на каждой из 24 страниц.
//
// Вынесение в файл с 'self' из CSP решает проблему без ослабления политики
// до 'unsafe-inline' (которое открыло бы XSS-инъекции инлайн-скриптов).
// Порядок гарантирован `defer`: этот файл подключён ПОСЛЕ SDK OneSignal
// в index.html, defer сохраняет порядок выполнения.
window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function (OneSignal) {
  try {
    await OneSignal.init({
      appId: 'd1cb2724-f8e5-40c4-8dec-2db841c83cba',
      safari_web_id: 'web.onesignal.auto.26339961-08fd-44e5-8197-7ce61bb1927b',
      notifyButton: { enable: false },
      allowLocalhostAsSecureOrigin: true,
    });
    window.OneSignal = OneSignal;
  } catch (e) {
    console.warn('OneSignal init skipped:', e && e.message);
  }
});