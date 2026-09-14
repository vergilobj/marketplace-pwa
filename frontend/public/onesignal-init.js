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
      // Мягкий промпт показываем СРАЗУ (без задержки).
      // ⚠️ Chrome запрещает вызывать нативный запрос разрешения без клика
      // пользователя (политика с 2020). Поэтому сразу показываем свой
      // slidedown, а нативное разрешение спрашивается после «Да, включить».
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
              delay: { pageViews: 1, timeDelay: 0 },
            },
          ],
        },
      },
      allowLocalhostAsSecureOrigin: true,
    });

    // Если разрешение ещё не выдано — показываем промпт сразу при входе.
    // В v16 есть только OneSignal.Slidedown.promptPush()
    // (метода setIsSlidedownAllowed из v15 больше НЕТ).
    //
    // ⚠️ iOS-исключение: Apple разрешает web push ТОЛЬКО для приложений,
    // добавленных на главный экран (iOS 16.4+). В обычной вкладке Safari
    // промпт показать невозможно — вместо него даём инструкцию.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const needsPermission = typeof Notification === 'undefined' ||
      Notification.permission === 'default';

    if (isIOS && !isStandalone && needsPermission) {
      showIOSInstallHint();
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        if (OneSignal.Slidedown?.promptPush) {
          await OneSignal.Slidedown.promptPush();
        }
      } catch (e) {
        console.warn('Slidedown prompt skipped:', e && e.message);
      }
    }
    window.OneSignal = OneSignal;
  } catch (e) {
    console.warn('OneSignal init skipped:', e && e.message);
  }
});

// Подсказка для iOS: без «Добавить на экран Домой» пуши не работают.
function showIOSInstallHint() {
  if (document.getElementById('ios-push-hint')) return;
  if (sessionStorage.getItem('ios_push_hint_closed') === '1') return;

  const el = document.createElement('div');
  el.id = 'ios-push-hint';
  el.setAttribute('role', 'dialog');
  el.style.cssText = [
    'position:fixed', 'left:12px', 'right:12px', 'bottom:96px', 'z-index:2147483001',
    'background:#151918', 'color:#e8ece9', 'border:1px solid rgba(34,197,94,.35)',
    'border-radius:16px', 'padding:14px 16px', 'font:14px/1.45 -apple-system,system-ui,sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,.45)',
  ].join(';');
  el.innerHTML =
    '<div style="display:flex;gap:10px;align-items:flex-start">' +
      '<div style="font-size:20px;line-height:1">🔔</div>' +
      '<div style="flex:1">' +
        '<div style="font-weight:700;margin-bottom:4px">Включить уведомления</div>' +
        '<div style="opacity:.85">На iPhone пуши работают только если добавить Базар на экран «Домой».' +
        ' Нажми <b>Поделиться</b> <span style="opacity:.7">⎋</span> → <b>«На экран Домой»</b>,' +
        ' затем открой приложение с иконки.</div>' +
      '</div>' +
      '<button id="ios-push-hint-close" aria-label="Закрыть" ' +
        'style="background:none;border:0;color:#8b9691;font-size:20px;line-height:1;cursor:pointer;padding:0 2px">×</button>' +
    '</div>';
  document.body.appendChild(el);

  document.getElementById('ios-push-hint-close')?.addEventListener('click', () => {
    sessionStorage.setItem('ios_push_hint_closed', '1');
    el.remove();
  });
}