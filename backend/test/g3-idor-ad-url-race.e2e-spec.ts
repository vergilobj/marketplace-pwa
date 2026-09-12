/**
 * G3 (интеграционный, РЕАЛЬНАЯ БД + РЕАЛЬНЫЕ HTTP-запросы): три фикса задачи
 * проверяются живьём, а не моками.
 *
 *   1. `GET /orders/:id` больше НЕ отдаёт телефон контрагента (buyer/seller),
 *      при этом форма ответа не сломана (id/name на месте, owner-чек работает).
 *   2. `GET /posts/:id`:
 *        неоплаченная реклама  — аноним 404, автор 200, ADMIN 200;
 *        оплаченная реклама    — аноним 200;
 *        обычный пост          — аноним 200 (не сломали).
 *   3. `POST /users/me/withdrawal` — два ПАРАЛЛЕЛЬНЫХ запроса на всю сумму:
 *      ровно одна заявка создаётся, вторая получает 400.
 *
 * Почему интеграционный, а не юнит: все три дефекта — про то, что реально
 * уходит в HTTP-ответ/в БД. Юнит с моком Prisma доказывает только то, что мы
 * вызвали функцию.
 *
 * AppModule поднимается целиком (реальный PrismaService, реальная БД
 * `marketplace` — та же, что у dev-сервера). Пользователи получают
 * phone-префикс G3, поэтому cleanupTestData сносит их вместе с заявками,
 * уведомлениями, постами и заказами.
 *
 * JWT подписывается тем же секретом, что и в бою: `JWT_ACCESS_SECRET` из
 * `backend/.env` (как это делает h1-deposit-end-to-end.integration.spec.ts).
 * Роли разные — поэтому подписываем токен на каждого участника отдельно, а не
 * берём один: `GET /posts/:id` ведёт себя по-разному для анонима, автора и ADMIN.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { LedgerAccount, UserRole } from '@prisma/client';
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
const PREFIX = 'g3-test-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('G3 (integration): телефон в заказе, доступ к рекламе, overcommit вывода', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const postIds: string[] = [];
  const productIds: string[] = [];

  let buyerId = '';
  let sellerId = '';
  let buyerToken = '';
  let sellerToken = '';
  let adminToken = '';

  const mkUser = async (tag: string, role: UserRole, availableBalance = 0) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `G3 ${tag}`,
        role,
        referralCode: `${SUFFIX}-${tag}`,
        isApproved: true,
        availableBalance,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /**
   * Токен подписываем ТЕМ ЖЕ секретом и с тем же payload, что AuthService:
   * { sub, phone, role }. JwtStrategy.validate читает именно их, а роли нужны
   * для RolesGuard (в части случаев он не задействован, но для ADMIN — да).
   */
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

    const buyer = await mkUser('buyer', UserRole.BUYER);
    const seller = await mkUser('seller', UserRole.SELLER);
    const admin = await mkUser('admin', UserRole.ADMIN);
    buyerId = buyer.id;
    sellerId = seller.id;

    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);
    sellerToken = tokenFor(seller.id, seller.phone, UserRole.SELLER);
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);
  });

  afterAll(async () => {
    // Уборка ПОЛНАЯ: юзеры + их заявки/уведомления/посты/заказы/товары.
    await cleanupTestData(
      prisma,
      { userIds, orderIds, postIds, productIds },
      { prefixes: [PREFIX] },
    );
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // ФИКС 1: телефон контрагента не утекает
  // ───────────────────────────────────────────────────────────────────────
  describe('ФИКС 1: GET /orders/:id не отдаёт телефон контрагента', () => {
    let orderId = '';

    beforeAll(async () => {
      const order = await prisma.order.create({
        data: {
          buyerId,
          sellerId,
          amount: 100,
          status: 'PENDING',
          platformFee: 10,
          referralBonus: 0,
          priceSource: 'PRODUCT',
        },
      });
      orderId = order.id;
      orderIds.push(order.id);
    });

    it('покупатель видит заказ, но НЕ видит телефон продавца', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);

      // Форма ответа не сломана: имена и id на месте.
      expect(res.body.seller.id).toBe(sellerId);
      expect(res.body.seller.name).toBe('G3 seller');
      expect(res.body.buyer.id).toBe(buyerId);

      // Сам фикс: поля phone нет ни у одной стороны.
      expect(res.body.seller).not.toHaveProperty('phone');
      expect(res.body.buyer).not.toHaveProperty('phone');
      expect(JSON.stringify(res.body)).not.toContain('g3-test-');
    });

    it('продавец тоже не видит телефон покупателя', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.buyer).not.toHaveProperty('phone');
      expect(res.body.seller).not.toHaveProperty('phone');
    });

    it('ADMIN видит заказ (owner-чек не сломан)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(orderId);
    });

    it('посторонний получает 403 (доступ по-прежнему только у участников)', async () => {
      const stranger = await mkUser('stranger', UserRole.BUYER);
      const strangerToken = tokenFor(
        stranger.id,
        stranger.phone,
        UserRole.BUYER,
      );

      await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('аноним получает 401', async () => {
      await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // ФИКС 2: неоплаченная реклама недоступна по прямому URL
  // ───────────────────────────────────────────────────────────────────────
  describe('ФИКС 2: GET /posts/:id — неоплаченная реклама', () => {
    let unpaidAdId = '';
    let paidAdId = '';
    let plainPostId = '';
    let foreignAdId = '';

    beforeAll(async () => {
      // (а) Неоплаченная реклама: ровно так её создаёт createAd —
      //     isAd=true, isPinned=false, adExpireDate=null.
      const unpaidAd = await prisma.post.create({
        data: {
          title: 'G3 неоплаченная реклама',
          content: 'не должна открываться по прямому URL',
          authorId: sellerId,
          adOwnerId: sellerId,
          isAd: true,
          isPinned: false,
          adExpireDate: null,
        },
      });
      unpaidAdId = unpaidAd.id;
      postIds.push(unpaidAd.id);

      // (б) Оплаченная реклама: флаги выставил activateAdForOrder.
      const paidAd = await prisma.post.create({
        data: {
          title: 'G3 оплаченная реклама',
          content: 'должна открываться всем',
          authorId: sellerId,
          adOwnerId: sellerId,
          isAd: true,
          isPinned: true,
          adExpireDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      paidAdId = paidAd.id;
      postIds.push(paidAd.id);

      // (в) Обычный пост — не должен быть затронут.
      const plain = await prisma.post.create({
        data: {
          title: 'G3 обычный пост',
          content: 'открывается всем',
          authorId: sellerId,
          isAd: false,
        },
      });
      plainPostId = plain.id;
      postIds.push(plain.id);

      // (г) Чужая неоплаченная реклама: автор — buyer, а не seller.
      //     Нужна, чтобы автор ЛЮБОГО поста не считался владельцем.
      const foreign = await prisma.post.create({
        data: {
          title: 'G3 чужая неоплаченная реклама',
          content: 'seller не автор — не должен её видеть',
          authorId: buyerId,
          adOwnerId: buyerId,
          isAd: true,
          isPinned: false,
          adExpireDate: null,
        },
      });
      foreignAdId = foreign.id;
      postIds.push(foreign.id);
    });

    it('неоплаченная реклама: аноним → 404', async () => {
      await request(app.getHttpServer())
        .get(`/posts/${unpaidAdId}`)
        .expect(404);
    });

    it('неоплаченная реклама: автор → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${unpaidAdId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.id).toBe(unpaidAdId);
      expect(res.body.isAd).toBe(true);
    });

    it('неоплаченная реклама: ADMIN → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${unpaidAdId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(unpaidAdId);
    });

    it('неоплаченная реклама: другой пользователь (не автор) → 404', async () => {
      await request(app.getHttpServer())
        .get(`/posts/${unpaidAdId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });

    it('чужая неоплаченная реклама: seller (не автор) → 404', async () => {
      await request(app.getHttpServer())
        .get(`/posts/${foreignAdId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(404);
    });

    it('оплаченная реклама: аноним → 200 (НЕ сломали)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${paidAdId}`)
        .expect(200);

      expect(res.body.id).toBe(paidAdId);
      expect(res.body.isAd).toBe(true);
      expect(res.body.isPinned).toBe(true);
    });

    it('обычный пост: аноним → 200 (НЕ сломали)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${plainPostId}`)
        .expect(200);

      expect(res.body.id).toBe(plainPostId);
      expect(res.body.isAd).toBe(false);
    });

    it('обычный пост: авторизованный → 200', async () => {
      await request(app.getHttpServer())
        .get(`/posts/${plainPostId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
    });

    it('просроченная реклама: аноним → 404 (уже не публична)', async () => {
      const expired = await prisma.post.create({
        data: {
          title: 'G3 просроченная реклама',
          authorId: sellerId,
          adOwnerId: sellerId,
          isAd: true,
          isPinned: true,
          adExpireDate: new Date(Date.now() - 60_000),
        },
      });
      postIds.push(expired.id);

      await request(app.getHttpServer())
        .get(`/posts/${expired.id}`)
        .expect(404);
    });

    it('несуществующий пост → 404', async () => {
      await request(app.getHttpServer())
        .get('/posts/g3-nonexistent-id-12345')
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // ФИКС 3: гонка pending-выводов
  // ───────────────────────────────────────────────────────────────────────
  describe('ФИКС 3: параллельные requestWithdrawal на всю сумму', () => {
    /**
     * Баланс — это АГРЕГАТ по LedgerEntry (LedgerService.getBalances), а не
     * `User.availableBalance` (тот только кэш для старых читателей). Поэтому
     * «кладём деньги» проводкой на счёт AVAILABLE.
     */
    const fund = async (userId: string, amount: number) => {
      await prisma.ledgerEntry.create({
        data: {
          userId,
          account: LedgerAccount.AVAILABLE,
          amount,
          currency: 'USDT',
          type: 'test_fund',
          refKey: `${SUFFIX}-fund-${userId}-${Math.random().toString(36).slice(2)}`,
        },
      });
    };

    it('ровно одна заявка создаётся, вторая → 400', async () => {
      const user = await mkUser('race', UserRole.SELLER);
      await fund(user.id, 500);
      const token = tokenFor(user.id, user.phone, UserRole.SELLER);

      const withdrawal = () =>
        request(app.getHttpServer())
          .post('/users/me/withdrawal')
          .set('Authorization', `Bearer ${token}`)
          .send({ amount: 500 });

      // ОБА запроса стартуют до того, как любой из них завершится.
      const [a, b] = await Promise.all([withdrawal(), withdrawal()]);

      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([201, 400]);

      // В БД ровно одна pending-заявка — и её сумма равна всей доступной.
      const rows = await prisma.withdrawalRequest.findMany({
        where: { userId: user.id, status: 'pending' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(500);

      // Проигравшая сторона получила внятную причину, а не 500.
      const failed = a.status === 400 ? a : b;
      expect(failed.body.message).toContain('Insufficient balance');

      // Контроль: третья попытка тоже упирается в лимит (Σpending учтён).
      await withdrawal().expect(400);
    });

    it('гонка на сумму вдвое больше баланса: проходит ровно одна', async () => {
      const user = await mkUser('race2', UserRole.SELLER);
      await fund(user.id, 300);
      const token = tokenFor(user.id, user.phone, UserRole.SELLER);

      // Каждый просит 200, вдвоём — 400 > 300. Сериализация должна
      // пропустить первую и отклонить вторую (200 > 100 остатка).
      const withdrawal = () =>
        request(app.getHttpServer())
          .post('/users/me/withdrawal')
          .set('Authorization', `Bearer ${token}`)
          .send({ amount: 200 });

      const [a, b] = await Promise.all([withdrawal(), withdrawal()]);
      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([201, 400]);

      const rows = await prisma.withdrawalRequest.findMany({
        where: { userId: user.id, status: 'pending' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(200);
    });

    it('свободный остаток корректно уменьшается на уже pending', async () => {
      const user = await mkUser('race3', UserRole.SELLER);
      await fund(user.id, 100);
      const token = tokenFor(user.id, user.phone, UserRole.SELLER);

      await request(app.getHttpServer())
        .post('/users/me/withdrawal')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 100 })
        .expect(201);

      // Всё выбрано — вторая заявка отклоняется.
      const res = await request(app.getHttpServer())
        .post('/users/me/withdrawal')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 100 })
        .expect(400);

      expect(res.body.message).toContain('Insufficient balance');

      const rows = await prisma.withdrawalRequest.findMany({
        where: { userId: user.id, status: 'pending' },
      });
      expect(rows).toHaveLength(1);
    });

    it('заявка сверх баланса отклоняется (контроль, без гонки)', async () => {
      const user = await mkUser('race4', UserRole.SELLER);
      await fund(user.id, 50);
      const token = tokenFor(user.id, user.phone, UserRole.SELLER);

      await request(app.getHttpServer())
        .post('/users/me/withdrawal')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 51 })
        .expect(400);
    });
  });
});
