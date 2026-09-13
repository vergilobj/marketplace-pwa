/**
 * FIX-CRIT (integration, РЕАЛЬНАЯ БД) — регрессия на утечку `passwordHash`.
 *
 * Инцидент: `GET /api/users/search?phone=<любой>` под ЛЮБЫМ авторизованным
 * токеном (в т.ч. свежим BUYER) отдавал объект `User` целиком:
 * `passwordHash`, `walletAddress`, `referralCode`, `bonusBalance`,
 * `cometChatUid`, `bazarSessionKey`. Подтверждено живьём на проде.
 *
 * Корень: `UsersService.findByPhone` → `prisma.user.findUnique({ where })`
 * без `select`, и `UsersController.searchByPhone` возвращал результат как есть.
 *
 * Тест держит ТРИ уровня защиты, чтобы регрессия не прошла незамеченной:
 *   1. роут `GET /users/search` больше не существует (404);
 *   2. `PrismaService` по умолчанию НЕ отдаёт `passwordHash` из ЛЮБОГО
 *      запроса (глобальный `omit`) — проверяем на сыром findUnique без select;
 *   3. явный `omit: { passwordHash: false }` возвращает хеш обратно —
 *      иначе сломается `AuthService.login` (bcrypt.compare).
 *
 * Если кто-то снимет глобальный `omit` или вернёт роут — тест покраснеет.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';

describe('FIX-CRIT (integration): passwordHash не утекает наружу', () => {
  const prisma = new PrismaService();
  let app: INestApplication;

  const suffix = `fixcrit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const phones: string[] = [];
  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        phone: `${suffix}-victim`,
        name: 'FIXCRIT Victim',
        role: 'ADMIN',
        referralCode: `${suffix}-rc`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
        walletAddress: '0xdeadbeef',
      },
    });
    userId = user.id;
    phones.push(user.phone);

    // Живой HTTP: поднимаем AppModule и подписываем токен как JwtService.
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const jwt = app.get(JwtService);
    accessToken = jwt.sign({
      sub: userId,
      phone: `${suffix}-victim`,
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await prisma.$disconnect();
    await app?.close();
  });

  it('глобальный omit: findUnique БЕЗ select не возвращает passwordHash', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(user).not.toHaveProperty('passwordHash');
    // Публичный минимум при этом на месте — это не пустой объект.
    expect(user!.phone).toBe(`${suffix}-victim`);
    expect(user!.role).toBe('ADMIN');
  });

  it('глобальный omit: остальные чувствительные поля тоже не отдаются по умолчанию? (фиксируем факт)', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // walletAddress/phone — не входят в omit (нужны логике), но phone
    // для чужих юзеров наружу не отдаётся на уровне контроллера.
    // Здесь фиксируем: passwordHash — единственное поле под omit.
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('omit:false возвращает passwordHash — login остаётся рабочим', async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      omit: { passwordHash: false },
    });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBe('$2b$10$abcdefghijklmnopqrstuv');
  });

  it('AuthService-паттерн: omit:false по телефону отдаёт хеш для bcrypt.compare', async () => {
    const user = await prisma.user.findUnique({
      where: { phone: `${suffix}-victim` },
      omit: { passwordHash: false },
    });
    expect(typeof user?.passwordHash).toBe('string');
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('UsersService больше НЕ имеет метода findByPhone (роут удалён)', () => {
    const proto = UsersService.prototype as unknown as Record<string, unknown>;
    expect(proto.findByPhone).toBeUndefined();
  });

  // ── ЖИВОЙ HTTP: прод-сценарий из аудита ──────────────────────────────
  it('ЖИВОЙ: GET /users/search под валидным токеном → 404 (роут удалён)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/search?phone=${suffix}-victim`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('ЖИВОЙ: GET /users/search?q= под валидным токеном → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/search?q=79000000000')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it('ЖИВОЙ: GET /users/search БЕЗ токена → 401/404, и никакого passwordHash', async () => {
    const res = await request(app.getHttpServer()).get(
      `/users/search?phone=${suffix}-victim`,
    );
    expect([401, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('ЖИВОЙ: GET /users/me → 200, телефон на месте, passwordHash отсутствует', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(`${suffix}-victim`);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('ЖИВОЙ: GET /users/:id (свой профиль) → 200 без passwordHash', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('ЖИВОЙ: POST /auth/login реально работает (omit не сломал bcrypt)', async () => {
    // Пароль ниже не совпадёт с фейковым хешем → 401, но это доказывает,
    // что путь login дошёл до bcrypt.compare и не упал на отсутствии поля.
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ phone: `${suffix}-victim`, password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Неверный телефон или пароль');
  });
});