/**
 * BUG-1 (интеграционный, РЕАЛЬНАЯ БД + РЕАЛЬНЫЕ HTTP-запросы):
 * `PATCH /users/seller-requests/:id` больше НЕ отклоняет заявку молча.
 *
 * Дефект: контроллер принимал `@Body() body: { approve: boolean }` и делал
 * `Boolean(body?.approve)`. При опечатке в имени поля (`{"status":"APPROVED"}`)
 * `approve === undefined` → `Boolean(undefined) === false` → заявка
 * ОТКЛОНЯЛАСЬ с ответом 200, продавец получал «Заявка отклонена».
 *
 * Теперь тело валидируется DTO `ReviewSellerRequestDto` с обязательным
 * `@IsBoolean() approve` → опечатка/пустое тело дают 400, а статус в БД
 * остаётся PENDING.
 *
 * Почему интеграционный: дефект ровно в том, что реально уходит в HTTP-ответ
 * и в БД. Юнит с моком Prisma доказал бы только факт вызова функции.
 *
 * AppModule поднимается целиком; ValidationPipe — ТОЧНО как в main.ts
 * (`whitelist` + `forbidNonWhitelisted`), иначе поведение разъедется.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { cleanupTestData } from '../src/common/prisma/test-db-cleanup';

const BACKEND_ENV = path.resolve(__dirname, '../.env');

/** Подтягиваем backend/.env — иначе JwtStrategy и подпись теста разойдутся. */
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

/** Namespace этой спеки: cleanupTestData снесёт всех юзеров с таким префиксом. */
const PREFIX = 'bug1-sr-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('BUG-1 (integration): PATCH /users/seller-requests/:id — строгая валидация approve', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const userIds: string[] = [];

  let adminToken = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `BUG1 ${tag}`,
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

  /** Заявка создаётся напрямую — эндпоинт подачи здесь не предмет теста. */
  const mkPendingRequest = async (userId: string) => {
    const req = await prisma.sellerRequest.create({
      data: { userId, status: 'PENDING' },
    });
    return req;
  };

  const patch = (id: string, body: unknown) =>
    request(app.getHttpServer())
      .patch(`/users/seller-requests/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Точная копия main.ts: и whitelist, и forbidNonWhitelisted.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);
  });

  afterAll(async () => {
    // SellerRequest не входит в cleanupTestData и держит User по RESTRICT —
    // сносим заявки наших юзеров сами, до общего свипа.
    if (userIds.length) {
      await prisma.sellerRequest.deleteMany({
        where: { userId: { in: userIds } },
      });
    }
    await cleanupTestData(prisma, { userIds }, { prefixes: [PREFIX] });
    await app.close();
  });

  // ── Главный кейс дефекта: опечатка в имени поля ────────────────────────
  it('{"status":"APPROVED"} (опечатка в имени поля) → 400, статус в БД НЕ меняется', async () => {
    const buyer = await mkUser('typo', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    const res = await patch(req.id, { status: 'APPROVED' }).expect(400);

    expect(JSON.stringify(res.body)).toContain('approve');

    const after = await prisma.sellerRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe('PENDING');
    expect(after?.reviewedAt).toBeNull();
    expect(after?.reviewedBy).toBeNull();

    // Роль покупателя не тронута — он не стал продавцом.
    const userAfter = await prisma.user.findUnique({
      where: { id: buyer.id },
    });
    expect(userAfter?.role).toBe(UserRole.BUYER);
  });

  it('пустое тело {} → 400 (раньше молча REJECTED)', async () => {
    const buyer = await mkUser('empty', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    await patch(req.id, {}).expect(400);

    const after = await prisma.sellerRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe('PENDING');
  });

  it('approve строкой "true" → 400 (boolean не подменяется)', async () => {
    const buyer = await mkUser('string', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    await patch(req.id, { approve: 'true' }).expect(400);

    const after = await prisma.sellerRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe('PENDING');
  });

  it('approve: null → 400', async () => {
    const buyer = await mkUser('null', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    await patch(req.id, { approve: null }).expect(400);
  });

  // ── Основной сценарий: одобрение работает ─────────────────────────────
  it('{"approve":true} → 200, статус APPROVED, роль стала SELLER', async () => {
    const buyer = await mkUser('approve', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    const res = await patch(req.id, { approve: true }).expect(200);
    expect(res.body.status).toBe('APPROVED');

    const after = await prisma.sellerRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe('APPROVED');
    expect(after?.reviewedBy).not.toBeNull();
    expect(after?.reviewedAt).not.toBeNull();

    const userAfter = await prisma.user.findUnique({
      where: { id: buyer.id },
    });
    expect(userAfter?.role).toBe(UserRole.SELLER);
  });

  it('{"approve":false} → 200, статус REJECTED, роль остаётся BUYER', async () => {
    const buyer = await mkUser('reject', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    const res = await patch(req.id, { approve: false }).expect(200);
    expect(res.body.status).toBe('REJECTED');

    const userAfter = await prisma.user.findUnique({
      where: { id: buyer.id },
    });
    expect(userAfter?.role).toBe(UserRole.BUYER);
  });

  it('note длиннее 500 символов → 400', async () => {
    const buyer = await mkUser('longnote', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    await patch(req.id, { approve: false, note: 'x'.repeat(501) }).expect(400);
  });

  it('лишнее поле при валидном approve → 400 (forbidNonWhitelisted)', async () => {
    const buyer = await mkUser('extra', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);

    await patch(req.id, { approve: true, surprise: 1 }).expect(400);
  });

  it('не-ADMIN получает 403 (гард не сломан)', async () => {
    const buyer = await mkUser('notadmin', UserRole.BUYER);
    const req = await mkPendingRequest(buyer.id);
    const buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);

    await request(app.getHttpServer())
      .patch(`/users/seller-requests/${req.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ approve: true })
      .expect(403);
  });
});