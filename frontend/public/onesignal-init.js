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
      appId: 'a78d28b5-776d-4fb8-ab1a-1fbf1bcb2758',
      safari_web_id: 'web.onesignal.auto.017f9378-7499-4b97-8d47-e55f2bb151c0',
      notifyButton: {
        enable: true,
        // Поднимаем колокольчик НАД нижним меню: по умолчанию он садится
        // в правый нижний угол (bottom: 20px) и перекрывает пункт «Войти»
        // в мобильном таб-баре (390px). 80px = высота меню + отступ.
        offset: { bottom: '80px', right: '15px' },
        showCredit: false,
      },
      // Мягкий промпт: показывается сам, без нативного запроса браузера.
      // Нативное разрешение спрашивается только после клика «Да» —
      // Chrome блокирует автозапросы без действия пользователя.
      promptOptions: {
        slidedown: {
          prompts: [
            {
              type: 'push',
              autoPrompt: true,
              text: {
                actionMessage: 'Сообщать о новых товарах и сообщениях?',
                acceptButton: 'Да, включить',
                cancelButton: 'Позже',
              },
              delay: { pageViews: 2, timeDelay: 20 },
            },
          ],
        },
      },
      allowLocalhostAsSecureOrigin: true,
    });
    window.OneSignal = OneSignal;
  } catch (e) {
    console.warn('OneSignal init skipped:', e && e.message);
  }
});