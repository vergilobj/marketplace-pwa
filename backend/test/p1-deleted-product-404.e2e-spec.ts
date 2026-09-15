/**
 * P1 (интеграционный, РЕАЛЬНАЯ БД + РЕАЛЬНЫЕ HTTP-запросы).
 *
 * Баг (воспроизведён живьём 2026-09-15): `DELETE /products/:id` → 200, товар
 * уходит из каталога (`isActive=false`), НО `GET /products/:id` открывался
 * АНОНИМНО и отдавал живую карточку: название, цену, продавца и кнопку
 * «Купить». `POST /orders` такой товар уже отклонял (400 «Товар недоступен») —
 * UI просто врал и вёл человека в непонятную ошибку, плюс утекало то, что
 * продавец считал удалённым.
 *
 * Корень: `ProductsService.findById` не проверял `isActive` (в отличие от
 * `findAll` с `where: { isActive: true }`), а роут `@Get(':id')` был без гарда.
 *
 * Почему интеграционный, а не юнит: дефект — про то, что реально уходит в
 * HTTP-ответ. Юнит с моком Prisma доказывает лишь, что мы вызвали функцию;
 * здесь же важен САМ КОД ОТВЕТА (200/404) для анонима, чужого, владельца и
 * ADMIN, а также то, что OptionalJwtAuthGuard не сломал анонимный доступ к
 * активным товарам.
 *
 * Пользователи получают phone-префикс `p1-`, поэтому cleanupTestData сносит их
 * вместе с товарами. Префикс зарегистрирован в ALL_TEST_PHONE_PREFIXES.
 *
 * JWT подписывается тем же секретом, что в бою: `JWT_ACCESS_SECRET` из
 * backend/.env, payload `{ sub, phone, role }` — как AuthService.
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
const PREFIX = 'p1-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('P1 (integration): удалённый товар недоступен по прямой ссылке', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const userIds: string[] = [];
  const productIds: string[] = [];

  let sellerId = '';
  let sellerToken = '';
  let buyerToken = '';
  let adminToken = '';
  let activeProductId = '';
  let deletedProductId = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `P1 ${tag}`,
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Тот же pipe, что в main.ts, — иначе поведение валидации разъедется.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const seller = await mkUser('seller', UserRole.SELLER);
    const buyer = await mkUser('buyer', UserRole.BUYER);
    const admin = await mkUser('admin', UserRole.ADMIN);
    sellerId = seller.id;

    sellerToken = tokenFor(seller.id, seller.phone, UserRole.SELLER);
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);

    // Товар создаём через РЕАЛЬНЫЙ роут — так проверяем и POST, и DELETE.
    const created = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'P1 активный товар',
        description: 'виден всем',
        price: 100,
      })
      .expect(201);
    activeProductId = created.body.id;
    productIds.push(activeProductId);

    const toDelete = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'P1 удалённый товар',
        description: 'не должен открываться по прямой ссылке',
        price: 999,
      })
      .expect(201);
    deletedProductId = toDelete.body.id;
    productIds.push(deletedProductId);

    // DELETE — тот самый роут из бага (soft-delete: isActive=false).
    await request(app.getHttpServer())
      .delete(`/products/${deletedProductId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await cleanupTestData(
      prisma,
      { userIds, productIds },
      { prefixes: [PREFIX] },
    );
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // ГЛАВНЫЙ ФИКС: удалённый товар
  // ───────────────────────────────────────────────────────────────────────
  describe('GET /products/:id — удалённый товар', () => {
    it('товар реально деактивирован в БД (предусловие)', async () => {
      const row = await prisma.product.findUnique({
        where: { id: deletedProductId },
        select: { isActive: true },
      });
      expect(row?.isActive).toBe(false);
    });

    it('АНОНИМ → 404 (было 200 с кнопкой «Купить»)', async () => {
      await request(app.getHttpServer())
        .get(`/products/${deletedProductId}`)
        .expect(404);
    });

    it('чужой BUYER → 404 (не подтверждаем существование)', async () => {
      await request(app.getHttpServer())
        .get(`/products/${deletedProductId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });

    it('владелец → 200 (видит свой удалённый товар)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${deletedProductId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.id).toBe(deletedProductId);
      expect(res.body.isActive).toBe(false);
    });

    it('ADMIN (не владелец) → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${deletedProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(deletedProductId);
    });

    it('телефон продавца не утекает в ответе', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${activeProductId}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SUFFIX);
    });

    it('несуществующий id → 404 как раньше', async () => {
      await request(app.getHttpServer())
        .get('/products/p1-nonexistent-id-12345')
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // РЕГРЕССИЯ: активные товары не сломаны
  // ───────────────────────────────────────────────────────────────────────
  describe('GET /products/:id — активный товар (поведение НЕ изменилось)', () => {
    it('АНОНИМ → 200 (главный регресс-кейс: гард не сделал роут закрытым)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${activeProductId}`)
        .expect(200);

      expect(res.body.id).toBe(activeProductId);
      expect(res.body.isActive).toBe(true);
      expect(res.body.title).toBe('P1 активный товар');
      expect(res.body.seller.id).toBe(sellerId);
    });

    it('авторизованный BUYER → 200', async () => {
      await request(app.getHttpServer())
        .get(`/products/${activeProductId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
    });

    it('битый/чужой токен не роняет запрос (OptionalJwtAuthGuard) → 200', async () => {
      await request(app.getHttpServer())
        .get(`/products/${activeProductId}`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(200);
    });

    it('список /products по-прежнему без удалённого товара', async () => {
      const res = await request(app.getHttpServer())
        .get('/products?limit=100')
        .expect(200);

      const ids = (res.body.items as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(activeProductId);
      expect(ids).not.toContain(deletedProductId);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Побочный канал: /similar не должен быть оракулом существования
  // ───────────────────────────────────────────────────────────────────────
  describe('GET /products/:id/similar — второй путь чтения товара по id', () => {
    it('АНОНИМ по удалённому товару → [] (не подтверждаем существование)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${deletedProductId}/similar`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('владелец по удалённому товару → 200 и непустой список кандидатов', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${deletedProductId}/similar`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      // Активный товар того же продавца обязан попасть в «похожие».
      const ids = (res.body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(activeProductId);
    });

    it('активный товар: аноним получает кандидатов (поведение не изменилось)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${activeProductId}/similar`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Фиксированные роуты не перехвачены `:id`
  // ───────────────────────────────────────────────────────────────────────
  describe('порядок роутов: фиксированные пути ДО :id', () => {
    it('GET /products/my работает (не ушёл в :id)', async () => {
      const res = await request(app.getHttpServer())
        .get('/products/my')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const ids = (res.body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(activeProductId);
    });

    it('GET /products/admin/list требует ADMIN (не ушёл в :id)', async () => {
      await request(app.getHttpServer())
        .get('/products/admin/list')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/products/admin/list')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
