/**
 * GAPS-A (интеграционный, РЕАЛЬНАЯ БД + РЕАЛЬНЫЕ HTTP): закрытие находок аудита.
 *
 *  1. 500 → 400/404 на роутах, где тело/параметр не валидировались (инлайн-тип
 *     вместо DTO → мусор доходил до Prisma → PrismaClientValidationError/P2025).
 *  2. Webhook с НЕВЕРНОЙ HMAC → 401 (было 200 {status:'rejected'}); с ВЕРНОЙ
 *     подписью → 200 (регрессия не сломана).
 *  3. Trust-оракул: несуществующий id и существующий-не-продавец дают
 *     ОДИНАКОВЫЙ 403 (было 404 vs 403 — перебором id можно было узнать, кто
 *     зарегистрирован).
 *
 * AppModule поднимается целиком; ValidationPipe — ТОЧНО как в main.ts
 * (whitelist + forbidNonWhitelisted), иначе поведение разъедется.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { cleanupTestData } from '../src/common/prisma/test-db-cleanup';

const BACKEND_ENV = path.resolve(__dirname, '../.env');

function loadBackendEnv(): void {
  if (!fs.existsSync(BACKEND_ENV)) return;
  for (const raw of fs.readFileSync(BACKEND_ENV, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadBackendEnv();

const PREFIX = 'gaps-a-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('GAPS-A (integration): 400/404 вместо 500, webhook HMAC→401, trust-оракул', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const userIds: string[] = [];
  let adminToken = '';
  let buyerToken = '';
  let buyerId = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `GAPSA ${tag}`,
        role,
        referralCode: `${SUFFIX}-${tag}`,
        isApproved: true,
      },
    });
    userIds.push(user.id);
    return user;
  };

  const tokenFor = (id: string, phone: string, role: UserRole) =>
    jwt.sign(
      { sub: id, phone, role },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Точная копия main.ts.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);

    const buyer = await mkUser('buyer', UserRole.BUYER);
    buyerId = buyer.id;
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);
  });

  afterAll(async () => {
    await cleanupTestData(prisma, { userIds }, { prefixes: [PREFIX] });
    await app.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 1. 500 → 400 (тело без DTO)
  // ────────────────────────────────────────────────────────────────────────
  describe('1. Мусор в теле → 400 (было 500)', () => {
    it('PATCH /users/:id/role {} → 400 (было 500)', async () => {
      await http()
        .patch(`/users/${buyerId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('PATCH /users/:id/role {role:"SUPERUSER"} → 400 (было 500)', async () => {
      await http()
        .patch(`/users/${buyerId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'SUPERUSER' })
        .expect(400);
    });

    it('PATCH /users/:id/role {role:"SELLER"} → 200 (валидный путь не сломан)', async () => {
      await http()
        .patch(`/users/${buyerId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'SELLER' })
        .expect(200);
      // возвращаем обратно, чтобы не влиять на trust-кейсы
      await http()
        .patch(`/users/${buyerId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'BUYER' })
        .expect(200);
    });

    it('PATCH /users/batch/role {userIds:"notarray",role:"ADMIN"} → 400 (было 500)', async () => {
      await http()
        .patch('/users/batch/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userIds: 'notarray', role: 'ADMIN' })
        .expect(400);
    });

    it('PATCH /users/batch/approve {} → 400 (было 200 no-op)', async () => {
      await http()
        .patch('/users/batch/approve')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('POST /social/:postId/comments {text:123} → 400 (было до Prisma)', async () => {
      await http()
        .post(`/social/${randomUUID()}/comments`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ text: 123 })
        .expect(400);
    });

    it('POST /bazar/products/generate {} → 400 (было 201 {"title":"undefined"})', async () => {
      await http()
        .post('/bazar/products/generate')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({})
        .expect(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. 500 → 404 (несуществующий id, Prisma P2025)
  // ────────────────────────────────────────────────────────────────────────
  describe('2. Несуществующий id → 404 (было 500)', () => {
    it('DELETE /invites/:code (несущ.) → 404', async () => {
      await http()
        .delete(`/invites/NOPE-${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('PATCH /notifications/:id/read (несущ.) → 404 (было 200 {count:0})', async () => {
      await http()
        .patch(`/notifications/${randomUUID()}/read`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Webhook HMAC → 401 / 200
  // ────────────────────────────────────────────────────────────────────────
  describe('3. Webhook HMAC', () => {
    const secret = () => process.env.PAYMOD_SHARED_SECRET as string;
    const post = (body: string, ts: string, sig: string) =>
      http()
        .post('/payments/paymod/webhook')
        .set('Content-Type', 'application/json')
        .set('x-paymod-timestamp', ts)
        .set('x-paymod-signature', sig)
        .send(body);

    it('POST /payments/paymod/webhook неверная HMAC → 401 (было 200)', async () => {
      const body = JSON.stringify({ event: 'sweep.confirmed', id: 'x' });
      const ts = String(Math.floor(Date.now() / 1000));
      await post(body, ts, 'not-a-valid-signature').expect(401);
    });

    it('POST /payments/paymod/webhook БЕЗ подписи → 401', async () => {
      await http()
        .post('/payments/paymod/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: 'sweep.confirmed' }))
        .expect(401);
    });

    it('РЕГРЕССИЯ: верная HMAC → 200 (легитимный webhook не сломан)', async () => {
      const body = JSON.stringify({ event: 'sweep.confirmed', id: 'x' });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', secret())
        .update(`${ts}.${body}`)
        .digest('base64');
      await post(body, ts, sig).expect(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Trust-оракул: 404 vs 403 → одинаковый 403
  // ────────────────────────────────────────────────────────────────────────
  describe('4. Trust-оракул', () => {
    it('несуществующий id (BUYER) → 403 (было 404)', async () => {
      await http()
        .get(`/bazar/users/${randomUUID()}/trust`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(403);
    });

    it('существующий НЕ-продавец (BUYER) → 403, тот же статус', async () => {
      const stranger = await mkUser('stranger', UserRole.BUYER);
      await http()
        .get(`/bazar/users/${stranger.id}/trust`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(403);
    });

    it('свой профиль → 200 (легитимное поведение сохранено)', async () => {
      const res = await http()
        .get(`/bazar/users/${buyerId}/trust`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body).toHaveProperty('trustScore');
    });
  });
});