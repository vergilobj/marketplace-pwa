# Деплой marketplace-pwa

## Архитектура

```
Пользователь → nginx (443) → /api/* → backend (3000)
                            → /*     → frontend static
```

## Подготовка сервера

```bash
# Установить Docker и Docker Compose
curl -fsSL https://get.docker.com | bash

# Клонировать репозиторий
git clone <repo-url> /opt/marketplace
cd /opt/marketplace

# Скопировать .env
cp backend/.env.example backend/.env
# Заполнить: DATABASE_URL, JWT секреты, CometChat ключи, OneSignal ключ
nano backend/.env
```

## Запуск

```bash
# Инфраструктура (PostgreSQL + Redis)
docker compose up -d

# Бэкенд (вручную или через Docker)
cd backend && npm ci && npx prisma migrate deploy && npm run build && node dist/src/main.js

# Или через Dockerfile:
docker build -t marketplace-backend backend/
docker run -d --name backend --env-file backend/.env -p 3000:3000 marketplace-backend

# Фронтенд — собрать и отдать через nginx
cd frontend && npm ci && npm run build
```

## Зеркалирование на новый домен (ТЗ п.20)

Цель: развернуть копию на новом домене за 1-2 часа.

**Автоматический способ:** запустить `bash mirror-deploy.sh user@new-server new-domain.ru`

### Ручной способ (если скрипт не подходит)

### Шаг 1: Клонировать код
```bash
rsync -avz /opt/marketplace/ user@new-server:/opt/marketplace/
```

### Шаг 2: Перенести БД
```bash
# На старом сервере
pg_dump -U market_user marketplace > /tmp/backup.sql
scp /tmp/backup.sql user@new-server:/tmp/

# На новом сервере
psql -U market_user marketplace < /tmp/backup.sql
```

### Шаг 3: Настроить домен
- Указать A-запись нового домена на IP сервера
- Обновить CORS_ORIGIN в .env
- Поменять server_name в nginx.conf
- Перевыпустить SSL: `certbot --nginx -d new-domain.ru`

### Шаг 4: OneSignal
- В админке OneSignal добавить новый домен в Origins
- Пользователи продолжат получать пуши без переустановки PWA

### Шаг 5: Инструкция пользователям при смене домена
- Отправить пуш/пост: «Приложение доступно по новому адресу: https://new-domain.ru»
- Инструкция по переустановке PWA:
  1. Открыть новый URL в Safari/Chrome
  2. Нажать «Поделиться» → «На экран "Домой"»
  3. Старое приложение можно удалить

## Проверка работоспособности

```bash
# Бэкенд
curl http://localhost:3000/products  # → 200, []

# Фронтенд
curl -I https://new-domain.ru  # → 200
```

## Переменные окружения (backend/.env)

| Переменная | Описание |
|-----------|----------|
| DATABASE_URL | PostgreSQL DSN |
| JWT_ACCESS_SECRET | Секрет для access-токенов |
| JWT_REFRESH_SECRET | Секрет для refresh-токенов |
| COMETCHAT_APP_ID | CometChat App ID |
| COMETCHAT_AUTH_KEY | CometChat Auth Key |
| COMETCHAT_REST_API_KEY | CometChat REST API Key |
| COMETCHAT_WEBHOOK_SECRET | Секрет для HMAC вебхуков |
| ONESIGNAL_APP_ID | OneSignal App ID |
| ONESIGNAL_REST_API_KEY | OneSignal REST API Key |
| UPLOAD_BASE_URL | Базовый URL для загрузок |
| REDIS_URL | Redis DSN (по умолчанию redis://localhost:6379) |
| CORS_ORIGIN | Разрешённый origin для CORS |
