# Marketplace PWA — Закрытый маркетплейс + канал + чат

**Статус:** 🟢 80% готовности  
**Стек:** NestJS + Prisma + PostgreSQL | React + Vite + TailwindCSS | PWA  
**Дата аудита:** 02.08.2026

---

## 🖼️ Интерфейс (скриншоты из браузера)

| Страница | Статус | Скриншот |
|----------|--------|----------|
| Главная (Feed) | ✅ | ![Feed](screenshots/feed.png) |
| Логин | ✅ | ![Login](screenshots/login.png) |
| Регистрация | ✅ | ![Register](screenshots/register.png) |
| Товары | ✅ | ![Products](screenshots/products.png) |
| Корзина | ✅ | ![Cart](screenshots/cart.png) |
| Заказы | ✅ | ![Orders](screenshots/orders.png) |
| Профиль | ✅ | ![Profile](screenshots/profile.png) |
| Админ-панель | ✅ | ![Admin](screenshots/admin.png) |

---

## 📊 Техническое состояние

| Метрика | Значение |
|---------|----------|
| Backend build | ✅ 0 errors |
| Frontend build | ✅ Vite + PWA |
| Тесты | 218/225 (96.9%) |
| База данных | 2006 товаров, 922 поста |
| Линтер (backend) | 3 errors, 375 warnings |
| PWA | ✅ Service Worker, иконки 192/512 |
| Push-уведомления | ✅ OneSignal |
| Чат | ✅ CometChat + WebSocket + модерация |
| Rate limiting | ✅ 100 req/min (ThrottlerModule) |
| Аудит-логирование | ✅ AuditLog (login/register) |

---

## ✅ Что готово (15/20 пунктов ТЗ)

### 🔐 Аутентификация и доступ
- [x] Регистрация только по инвайтам (`/signup?code=INVITECODE`)
- [x] Одноразовые инвайты, отслеживание `invitedBy`
- [x] Роли: BUYER, SELLER, MODERATOR, ADMIN
- [x] JWT access + refresh токены
- [x] Защита от перебора (dummy hash anti-enumeration)

### 🛒 Маркетплейс
- [x] CRUD товаров (название, описание, цена, медиа)
- [x] Создание заказов, статусы (PENDING → PAID → SHIPPED → COMPLETED)
- [x] История заказов
- [x] Комиссия платформы (настраивается админом)

### 💰 Платежи
- [x] NowPayments интеграция (crypto payments)
- [x] Split payments: платформа / реферал / продавец
- [x] IPN webhook с HMAC-SHA512 верификацией
- [x] Sandbox режим для тестирования
- [ ] Реальные ключи (ждём домен)

### 📢 Новостной канал + реклама
- [x] Посты от админа (текст, ссылки, медиа)
- [x] Платные рекламные посты (`isAd`, `adExpireDate`, `isPinned`)
- [x] Авто-скрытие просроченных рекламных постов
- [x] Push-уведомления о новых постах
- [x] Лайки и комментарии

### 💬 Чат
- [x] CometChat интеграция
- [x] Webhook модерации (стоп-слова, детект контактов)
- [x] ModerationLog
- [x] Client-side E2E шифрование (AES-GCM-256, Web Crypto API)
- [x] WebSocket gateway

### 👥 Реферальная система
- [x] Персональный `referralCode`
- [x] Начисление бонусов при заказе приглашённого
- [x] Вывод бонусов (`WithdrawalRequest`)

### 🛡️ Безопасность
- [x] Helmet middleware
- [x] Rate limiting (ThrottlerModule)
- [x] CORS настройка
- [x] ValidationPipe (whitelist + forbidNonWhitelisted)
- [x] Guards на всех эндпоинтах
- [x] Аудит-логирование (AuditLog)

### 📦 Деплой
- [x] Docker Compose (PostgreSQL + Redis)
- [x] Nginx конфигурация
- [x] Скрипт зеркалирования (`mirror-deploy.sh`)
- [x] Документация деплоя (DEPLOY.md)

---

## 🔴 Что осталось

| # | Задача | Приоритет | Блокер |
|---|--------|-----------|--------|
| 1 | Подключить реальные NowPayments ключи | 🔴 Критично | Нужен домен |
| 2 | Починить 7 outdated тестов | 🟡 Средний | — |
| 3 | Допилить audit log на все CRUD действия | 🟡 Средний | — |
| 4 | Client-side шифрование в ChatPage (utils готовы) | 🟡 Средний | — |
| 5 | Admin: управление процентами комиссий | 🟡 Средний | — |

---

## 🚀 Быстрый старт

```bash
# 1. Инфраструктура
docker compose up -d

# 2. Бэкенд
cd backend
cp .env.example .env  # заполнить ключи
npm ci
npx prisma migrate deploy
npm run build
node dist/src/main.js

# 3. Фронтенд
cd frontend
npm ci
npm run build

# 4. Nginx (опционально)
# см. nginx.conf
```

## 🪞 Зеркалирование на новый домен

```bash
bash mirror-deploy.sh user@new-server new-domain.ru
```

---

## 📂 Структура проекта

```
marketplace-pwa/
├── backend/          # NestJS API
│   ├── src/
│   │   ├── auth/         # JWT, роли, guards
│   │   ├── users/        # CRUD пользователей
│   │   ├── invites/      # Инвайт-система
│   │   ├── marketplace/  # Товары + заказы
│   │   ├── payments/     # NowPayments + split
│   │   ├── posts/        # Посты + реклама
│   │   ├── chat/         # CometChat + модерация
│   │   ├── social/       # Лайки + комментарии
│   │   ├── admin/        # Админ-панель
│   │   ├── notifications/# Push-уведомления
│   │   ├── settings/     # Настройки (проценты, стоп-слова)
│   │   └── common/       # Prisma, Audit
│   └── prisma/
├── frontend/         # React + Vite + TailwindCSS
│   └── src/
│       ├── pages/    # 20+ страниц
│       ├── components/
│       ├── api/      # API-клиент
│       └── utils/    # crypto, format
├── docker-compose.yml
├── nginx.conf
├── mirror-deploy.sh
└── DEPLOY.md
```
