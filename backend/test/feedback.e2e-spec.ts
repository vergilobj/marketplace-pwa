/**
 * «Обратная связь» — интеграционный e2e (РЕАЛЬНАЯ БД + РЕАЛЬНЫЕ HTTP-запросы).
 *
 * Предмет проверки — ровно то, что нельзя доказать юнитом с моком Prisma:
 *   - запись реально ложится в `Feedback` и читается обратно;
 *   - `POST /feedback` с мусором валится на ValidationPipe (400), а не
 *     доходит до сервиса;
 *   - гард `/admin/feedback` не пускает BUYER (403);
 *   - при создании обращения у ВСЕХ админов появляется `Notification`;
 *   - при ответе админа уведомление приходит АВТОРУ.
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
const PREFIX = 'fb-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Обратная связь (integration): /feedback + /admin/feedback', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const userIds: string[] = [];

  let buyerToken = '';
  let buyerId = '';
  let adminId = '';
  let adminToken = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `FB ${tag}`,
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

  const postFeedback = (body: unknown, token = buyerToken) =>
    request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const buyer = await mkUser('buyer', UserRole.BUYER);
    buyerId = buyer.id;
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminId = admin.id;
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);
  });

  afterAll(async () => {
    // Feedback.userId — onDelete: Cascade, отдельная чистка не нужна.
    await cleanupTestData(prisma, { userIds }, { prefixes: [PREFIX] });
    await app.close();
  });

  // ── Создание ──────────────────────────────────────────────────────────
  it('POST /feedback с валидным телом → 201, запись в БД', async () => {
    const res = await postFeedback({
      type: 'CONSULTATION',
      message: 'Хочу консультацию по продажам на площадке',
      contact: '@buyer',
    }).expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.type).toBe('CONSULTATION');
    expect(res.body.status).toBe('NEW');

    const row = await prisma.feedback.findUnique({ where: { id: res.body.id } });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(buyerId);
    expect(row?.message).toBe('Хочу консультацию по продажам на площадке');
    expect(row?.contact).toBe('@buyer');
    expect(row?.status).toBe('NEW');
  });

  it('после создания у ВСЕХ админов есть Notification типа feedback', async () => {
    const before = await prisma.notification.count({
      where: { userId: adminId, type: 'feedback' },
    });

    const res = await postFeedback({
      type: 'SUGGESTION',
      message: 'Добавьте тёмную тему в каталог',
    }).expect(201);

    const after = await prisma.notification.findMany({
      where: { userId: adminId, type: 'feedback' },
      orderBy: { createdAt: 'desc' },
    });
    expect(after.length).toBe(before + 1);
    expect(after[0].message).toContain('Новое обращение');
    expect(after[0].message).toContain('предложение');
    // relatedId ведёт на само обращение — по нему админ найдёт его в списке.
    expect(after[0].relatedId).toBe(res.body.id);
  });

  it('GET /feedback/my → своё обращение видно, форма { items, total, page, limit }', async () => {
    const res = await request(app.getHttpServer())
      .get('/feedback/my')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBeGreaterThan(0);

    const mine = res.body.items as Array<{ userId: string; message: string }>;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((f) => f.userId === buyerId)).toBe(true);
  });

  // ── Валидация (мусор → 400, а не 500/запись) ──────────────────────────
  it('пустой message → 400, запись не создаётся', async () => {
    const before = await prisma.feedback.count();
    await postFeedback({ type: 'OTHER', message: '' }).expect(400);
    expect(await prisma.feedback.count()).toBe(before);
  });

  it('message из 2 символов → 400 (MinLength 3)', async () => {
    await postFeedback({ type: 'OTHER', message: 'ok' }).expect(400);
  });

  it('message длиннее 2000 → 400', async () => {
    await postFeedback({ type: 'OTHER', message: 'x'.repeat(2001) }).expect(400);
  });

  it('type: "ЛЕВОЕ" → 400', async () => {
    await postFeedback({ type: 'ЛЕВОЕ', message: 'валидный текст' }).expect(400);
  });

  it('отсутствующий type → 400', async () => {
    await postFeedback({ message: 'валидный текст' }).expect(400);
  });

  it('contact длиннее 200 → 400', async () => {
    await postFeedback({
      type: 'OTHER',
      message: 'валидный текст',
      contact: 'x'.repeat(201),
    }).expect(400);
  });

  it('лишнее поле → 400 (forbidNonWhitelisted)', async () => {
    await postFeedback({
      type: 'OTHER',
      message: 'валидный текст',
      surprise: 1,
    }).expect(400);
  });

  it('без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/feedback')
      .send({ type: 'OTHER', message: 'валидный текст' })
      .expect(401);
  });

  // ── Админский список: гард + фильтр + пагинация ───────────────────────
  it('GET /admin/feedback под BUYER → 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/feedback')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('GET /admin/feedback под ADMIN → 200, форма { items, total, page, limit }', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/feedback')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    const items = res.body.items as Array<{ user?: { id: string } }>;
    expect(items.length).toBeGreaterThan(0);
    // Автор подтянут relation'ом — админу нужен телефон для связи.
    expect(items[0].user?.id).toBeTruthy();
  });

  it('GET /admin/feedback?status=CLOSED → только закрытые', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/feedback?status=CLOSED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const items = res.body.items as Array<{ status: string }>;
    expect(items.every((f) => f.status === 'CLOSED')).toBe(true);
  });

  it('GET /admin/feedback?limit=abc → 400 (потолок пагинации, а не молчаливый дефолт)', async () => {
    await request(app.getHttpServer())
      .get('/admin/feedback?limit=abc')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  // ── Ответ админа: смена статуса + уведомление автору ──────────────────
  it('PATCH /admin/feedback/:id под ADMIN → 200, статус сменился, автор уведомлён', async () => {
    const created = await postFeedback({
      type: 'QUESTION',
      message: 'Когда появится доставка в мой город?',
    }).expect(201);

    const notifBefore = await prisma.notification.count({
      where: { userId: buyerId, type: 'feedback' },
    });

    const res = await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS', adminNote: 'Уточняем у логистов' })
      .expect(200);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.adminNote).toBe('Уточняем у логистов');

    const row = await prisma.feedback.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.status).toBe('IN_PROGRESS');
    expect(row?.adminNote).toBe('Уточняем у логистов');

    // Автор получил уведомление об ответе.
    const notifAfter = await prisma.notification.count({
      where: { userId: buyerId, type: 'feedback' },
    });
    expect(notifAfter).toBe(notifBefore + 1);
  });

  it('PATCH /admin/feedback/:id под BUYER → 403, статус в БД не меняется', async () => {
    const created = await postFeedback({
      type: 'BUG',
      message: 'Кнопка не нажимается на айфоне',
    }).expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.body.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'CLOSED' })
      .expect(403);

    const row = await prisma.feedback.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.status).toBe('NEW');
  });

  it('PATCH со status: "ЛЕВОЕ" → 400', async () => {
    const created = await postFeedback({
      type: 'OTHER',
      message: 'Ещё одно обращение для проверки валидации',
    }).expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ЛЕВОЕ' })
      .expect(400);
  });

  it('PATCH с adminNote длиннее 1000 → 400', async () => {
    const created = await postFeedback({
      type: 'OTHER',
      message: 'Обращение под длинную заметку',
    }).expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ adminNote: 'x'.repeat(1001) })
      .expect(400);
  });

  it('PATCH несуществующего id → 404 (NotFoundException, не 500)', async () => {
    await request(app.getHttpServer())
      .patch('/admin/feedback/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLOSED' })
      .expect(404);
  });
});