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

// 🔴 ПЛАШКА ПОКАЗЫВАЕТСЯ ПОСЛЕ ДЕЙСТВИЯ, А НЕ СРАЗУ.
//
// Раньше вызов стоял по DOMContentLoaded — плашка вылезала поверх страницы
// входа до того, как человек что-либо сделал, и перекрывала форму (реальный
// баг 2026-09-15). Теперь ждём первого ОСМЫСЛЕННОГО действия: пользователь
// открыл карточку товара. Только тогда спрашиваем про уведомления.
//
// ⚠️ Ветку iOS и проверку permission НЕ трогаем: инструкция «Добавить на
// экран Домой» не зависит от OneSignal и не должна съедаться падением init
// (баг 2026-09-14 — владелец не видел подсказку вообще).
(function armPushPromptEarly() {
  let armed = true;
  let timer = null;

  const fire = () => {
    if (!armed) return;
    armed = false;
    if (timer) { clearInterval(timer); timer = null; }
    try { maybeShowPushPrompt(window.OneSignal || null); }
    catch (e) { console.warn('push prompt error:', e && e.message); }
  };

  // «Выбрал что-то» = открыл карточку товара.
  const isProductPath = () => /^\/products\/[^/]+/.test(location.pathname);

  const start = () => {
    // Уже на карточке (заход по прямой ссылке) — показываем после паузы,
    // чтобы человек успел увидеть товар.
    if (isProductPath()) { setTimeout(fire, 1200); return; }

    // Клик по ссылке на товар — момент выбора.
    document.addEventListener('click', (ev) => {
      const el = ev.target;
      if (el && el.closest && el.closest('a[href*="/products/"]')) {
        setTimeout(fire, 800);
      }
    }, true);

    // SPA-переход на карточку (в т.ч. программный).
    let last = location.pathname;
    timer = setInterval(() => {
      if (!armed) { clearInterval(timer); timer = null; return; }
      if (location.pathname !== last) {
        last = location.pathname;
        if (isProductPath()) setTimeout(fire, 800);
      }
    }, 600);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

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
      // Дефолтный slidedown OneSignal ОТКЛЮЧЁН (prompts: []) —
      // показываем своё модальное окно в стиле Базара (см. showPushPrompt).
      promptOptions: {
        slidedown: { prompts: [] },
      },
      allowLocalhostAsSecureOrigin: true,
    });

    window.OneSignal = OneSignal;
  } catch (e) {
    console.warn('OneSignal init skipped:', e && e.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Своё модальное окно подписки в стиле Базара.
// ─────────────────────────────────────────────────────────────────────────

function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
  const isAndroid = /Android/.test(ua);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return { isIOS, isAndroid, isStandalone };
}

function currentPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission) {
      return Notification.permission; // 'default' | 'granted' | 'denied'
    }
  } catch (_) { /* noop */ }
  return 'unsupported';
}

function maybeShowPushPrompt(OneSignal) {
  const { isIOS, isStandalone } = detectPlatform();

  // 🔴 ВАЖНО: ветку iOS проверяем ПЕРВОЙ, до проверки permission.
  // В обычной вкладке Safari на iOS web push НЕ поддерживается, и браузер
  // может вернуть `denied` — ранний return по permission съедал инструкцию
  // «Добавить на экран Домой». Инструкция про установку приложения не
  // зависит от разрешения — её показываем, пока приложение не добавлено.
  if (isIOS && !isStandalone) {
    showPushPrompt('ios-install', OneSignal);
    return;
  }

  const perm = currentPermission();

  // Уже подписаны или отказались — не мозолим глаза (Android/десктоп/standalone).
  if (perm === 'granted') return;
  if (perm === 'denied') return;

  // iOS уже на экране «Домой» или Android/десктоп — можно просить разрешение.
  showPushPrompt('enable', OneSignal);
}

/**
 * Модальное окно подписки.
 *
 * 🔴 Это МОДАЛКА, а не всплывашка: фон затемняется и становится недоступным,
 * прокрутка страницы блокируется, фокус заперт внутри окна. Поэтому окно
 * центрируется — подгонять позицию под поля/кнопки больше не нужно
 * (прежний `avoidOverlap` с ретраями удалён как ненужный).
 */
function showPushPrompt(mode, OneSignal) {
  if (document.getElementById('bazar-push-prompt')) return;
  // ⚠️ sessionStorage может бросать в приватном режиме Safari — оборачиваем.
  try {
    if (sessionStorage.getItem('bazar_push_prompt_closed') === '1') return;
  } catch (_) { /* storage недоступен — просто показываем окно */ }

  const C = {
    card: 'var(--card, #111d18)',
    line: 'var(--line-strong, #3a3a3a)',
    ink: 'var(--ink, #ffffff)',
    muted: 'var(--muted, #aaaaaa)',
    accent: 'var(--accent, #22c55e)',
    bg: 'var(--bg, #0d1512)',
  };

  const isIOS = mode === 'ios-install';

  // ── Затемняющий слой: перехватывает клики по странице под окном ──
  const back = document.createElement('div');
  back.id = 'bazar-push-backdrop';
  back.setAttribute('aria-hidden', 'true');
  back.style.cssText = [
    'position:fixed', 'inset:0',
    'background:rgba(0,0,0,.62)',
    'backdrop-filter:blur(2px)',
    '-webkit-backdrop-filter:blur(2px)',
    'z-index:2147483000',
    'opacity:0', 'transition:opacity .22s ease',
  ].join(';');

  const el = document.createElement('div');
  el.id = 'bazar-push-prompt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Включить уведомления');
  el.style.cssText = [
    'position:fixed',
    // Центр экрана — окно никого не перекрывает «в углу».
    'left:50%', 'top:50%',
    'transform:translate(-50%,-46%) scale(.96)',
    'width:calc(100% - 24px)', 'max-width:420px',
    'max-height:calc(100dvh - 32px)', 'overflow-y:auto', 'overscroll-contain',
    'z-index:2147483001',
    `background:${C.card}`, `color:${C.ink}`,
    // Граница + двойная тень: карточка НЕ должна сливаться с фоном страницы
    // (--card #111d18 и --bg #0d1512 близки). Сверху — тонкий светлый кант.
    `border:1px solid ${C.line}`,
    'border-radius:18px',
    'padding:16px 16px 14px',
    'font-family:var(--font-sans, Manrope, Inter, -apple-system, system-ui, sans-serif)',
    'font-size:14px', 'line-height:1.45',
    'box-shadow:0 -1px 0 rgba(255,255,255,.06) inset, 0 24px 60px rgba(0,0,0,.75)',
    'opacity:0',
    'transition:opacity .22s cubic-bezier(.2,.6,.3,1), transform .22s cubic-bezier(.2,.6,.3,1)',
  ].join(';');

  const body = isIOS
    ? 'На iPhone уведомления работают только из приложения. Добавь Базар на экран «Домой» — и всё заработает.'
    : 'Сообщим, когда появятся новые товары, придёт сообщение или ответит продавец.';

  const icon = isIOS
    // «Поделиться» — квадрат со стрелкой вверх
    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>'
    // колокольчик
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  const steps = isIOS
    ? '<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">' +
        stepRow('1', 'Нажми <b>Поделиться</b> внизу Safari') +
        stepRow('2', 'Выбери <b>«На экран Домой»</b>') +
        stepRow('3', 'Открой Базар с иконки') +
      '</div>'
    : '';

  const actions = isIOS
    ? `<button id="bazar-push-ok" style="${btnStyle(C, true)}">Понятно</button>`
    : `<button id="bazar-push-yes" style="${btnStyle(C, true)}">Включить</button>` +
      `<button id="bazar-push-no" style="${btnStyle(C, false)}">Позже</button>`;

  el.innerHTML =
    '<div style="display:flex;gap:12px;align-items:flex-start">' +
      `<div style="flex:0 0 auto;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${C.accent} 16%, transparent);color:${C.accent}">${icon}</div>` +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:700;font-size:15px;margin-bottom:3px">Включить уведомления</div>' +
        `<div style="color:${C.muted}">${body}</div>` +
        steps +
      '</div>' +
      `<button id="bazar-push-close" aria-label="Закрыть" style="flex:0 0 auto;width:44px;height:44px;margin:-12px -12px 0 0;background:none;border:0;color:${C.muted};font-size:22px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">×</button>` +
    '</div>' +
    `<div style="display:flex;gap:8px;margin-top:14px">${actions}</div>`;

  document.body.appendChild(back);
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    back.style.opacity = '1';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,-50%) scale(1)';
  });

  // Фон страницы не должен прокручиваться под модалкой.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  attachPushPromptHandlers(el, back, isIOS, OneSignal, prevOverflow);
}

/**
 * Обработчики кнопок + жизненный цикл модалки.
 *
 * @param el          карточка окна
 * @param back        затемняющий слой
 * @param isIOS       ветка iOS-инструкции (одна кнопка «Понятно»)
 * @param OneSignal   SDK (может быть null — тогда просто закрываемся)
 * @param prevOverflow прежнее значение overflow у body (вернуть при закрытии)
 */
function attachPushPromptHandlers(el, back, isIOS, OneSignal, prevOverflow) {
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;

    // ⚠️ ПОРЯДОК КРИТИЧЕН: сначала визуально прячем и снимаем блокировки,
    // потом пишем в хранилище. В приватном режиме Safari `sessionStorage`
    // бросает QuotaExceededError — раньше setItem стоял ПЕРВЫМ, исключение
    // прерывало функцию, и модалка оставалась висеть (баг 2026-09-14).
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%,-46%) scale(.96)';
    back.style.opacity = '0';
    setTimeout(() => { el.remove(); back.remove(); }, 220);

    // Снимаем блокировки: прокрутка и перехват клавиш.
    document.body.style.overflow = prevOverflow || '';
    document.removeEventListener('keydown', onKey, true);

    try {
      sessionStorage.setItem('bazar_push_prompt_closed', '1');
    } catch (_) { /* приватный режим / storage заблокирован — не критично */ }
  };

  // Escape и Tab — клавиатурный контроль модалки.
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    // Фокус не должен уходить за пределы окна.
    const f = el.querySelectorAll('button, [href], input, select, textarea');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);

  document.getElementById('bazar-push-close')?.addEventListener('click', close);

  if (isIOS) {
    document.getElementById('bazar-push-ok')?.addEventListener('click', close);
    // Фокус — на единственную кнопку, чтобы работала клавиатура.
    setTimeout(() => document.getElementById('bazar-push-ok')?.focus(), 240);
    return;
  }

  document.getElementById('bazar-push-no')?.addEventListener('click', close);

  document.getElementById('bazar-push-yes')?.addEventListener('click', () => {
    // ГЛАВНОЕ: закрываем окно СРАЗУ, синхронно, до всяких await.
    // Раньше close() стоял после await requestPermission() — если промис
    // не резолвился (iOS-PWA, закрытый системный диалог), окно висело
    // навсегда. Теперь исчезновение не зависит от ответа браузера.
    close();

    if (!OneSignal || !OneSignal.Notifications) return;

    // Дальше — разрешение в фоне. Клик уже случился (жест пользователя),
    // поэтому нативный запрос Chrome/Safari показать разрешено.
    (async () => {
      try {
        const granted = await Promise.race([
          OneSignal.Notifications.requestPermission(),
          new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
        ]);
        if (granted) {
          try { await OneSignal.User.PushSubscription.optIn(); } catch (_) { /* noop */ }
        }
      } catch (e) {
        console.warn('requestPermission failed:', e && e.message);
      }
    })();
  });

  // Фокус — на основную кнопку.
  setTimeout(() => document.getElementById('bazar-push-yes')?.focus(), 240);
}

function stepRow(n, text) {
  return '<div style="display:flex;gap:8px;align-items:flex-start;font-size:13px">' +
    `<span style="flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:color-mix(in srgb, var(--accent, #22c55e) 18%, transparent);color:var(--accent, #22c55e);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">${n}</span>` +
    `<span>${text}</span>` +
  '</div>';
}

function btnStyle(C, primary) {
  return [
    'flex:1', 'min-height:44px', 'border-radius:12px', 'padding:11px 14px',
    'font-size:14px', 'font-weight:600', 'cursor:pointer',
    'font-family:inherit',
    'display:flex', 'align-items:center', 'justify-content:center',
    'transition:opacity .15s',
    primary
      ? `background:${C.accent};color:${C.bg};border:1px solid ${C.accent}`
      : `background:transparent;color:${C.muted};border:1px solid ${C.line}`,
  ].join(';');
}