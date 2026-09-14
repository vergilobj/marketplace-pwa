/**
 * ЭТАП 1 ТЗ «Двусторонний диалог с админом» — интеграционный e2e треда.
 *
 * РЕАЛЬНАЯ БД (изолированная `marketplace_test`) + РЕАЛЬНЫЕ HTTP-запросы.
 * Предмет проверки — то, что нельзя доказать юнитом с моком Prisma:
 *   - первое сообщение обращения реально ложится в `FeedbackMessage`;
 *   - двусторонняя переписка меняет статусы по §4.3 (WAITING_ADMIN/WAITING_USER);
 *   - счётчики непрочитанного считаются из флагов сообщений;
 *   - `kind=NOTE` не виден автору, не двигает статус и не растит его счётчик;
 *   - чужой пользователь не читает и не пишет в тред (403);
 *   - уведомление автору при ответе админа + троттлинг админских уведомлений;
 *   - автозакрытие `WAITING_USER` старше 7 дней.
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
import { FeedbackService } from '../src/feedback/feedback.service';
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
const PREFIX = 'fbt-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Тред обращений (integration): /feedback/:id/messages + /admin/feedback', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let feedbackService: FeedbackService;

  const userIds: string[] = [];

  let buyerToken = '';
  let buyerId = '';
  let otherToken = '';
  let adminId = '';
  let adminToken = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `FBT ${tag}`,
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

  const createThread = async (
    body: Record<string, unknown> = {
      type: 'QUESTION',
      message: 'А сколько стоит доставка по Ижевску?',
    },
  ) => {
    const res = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(body)
      .expect(201);
    return res.body as { id: string; status: string; subject: string | null };
  };

  const getThread = (id: string, token = buyerToken) =>
    request(app.getHttpServer())
      .get(`/feedback/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const postUserMsg = (id: string, body: unknown, token = buyerToken) =>
    request(app.getHttpServer())
      .post(`/feedback/${id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const postAdminMsg = (id: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`/admin/feedback/${id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
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
    feedbackService = app.get(FeedbackService);

    const buyer = await mkUser('buyer', UserRole.BUYER);
    buyerId = buyer.id;
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);

    const other = await mkUser('other', UserRole.BUYER);
    otherToken = tokenFor(other.id, other.phone, UserRole.BUYER);

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminId = admin.id;
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);
  });

  afterAll(async () => {
    // Feedback.userId — onDelete: Cascade, FeedbackMessage уезжает вместе с ним.
    await cleanupTestData(prisma, { userIds }, { prefixes: [PREFIX] });
    await app.close();
  });

  // ── Создание: голова треда + первое сообщение ──────────────────────────

  it('POST /feedback создаёт и обращение, и первое сообщение треда', async () => {
    const created = await createThread({
      type: 'QUESTION',
      message: 'А сколько стоит доставка по Ижевску?',
      subject: 'Доставка',
      productId: null,
      source: 'PRODUCT',
    });

    const row = await prisma.feedback.findUnique({
      where: { id: created.id },
      include: { messages: true },
    });

    expect(row?.subject).toBe('Доставка');
    expect(row?.source).toBe('PRODUCT');
    expect(row?.lastMessageBy).toBe('USER');
    expect(row?.unreadForAdmin).toBe(1);
    expect(row?.unreadForUser).toBe(0);

    expect(row?.messages).toHaveLength(1);
    expect(row?.messages[0].authorRole).toBe('USER');
    expect(row?.messages[0].authorId).toBe(buyerId);
    expect(row?.messages[0].body).toBe('А сколько стоит доставка по Ижевску?');
    expect(row?.messages[0].kind).toBe('TEXT');
    // Автор своё сообщение прочитал, админ — ещё нет.
    expect(row?.messages[0].isReadByUser).toBe(true);
    expect(row?.messages[0].isReadByAdmin).toBe(false);
  });

  it('source со мусором → 400', async () => {
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ type: 'OTHER', message: 'проверка источника', source: 'ЛЕВОЕ' })
      .expect(400);
  });

  // ── Чтение треда ───────────────────────────────────────────────────────

  it('GET /feedback/:id — автор видит тред, unreadForUser обнуляется', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Вопрос по оплате картой',
    });

    // Имитируем ответ админа напрямую в БД, чтобы был непрочитанный ответ.
    await postAdminMsg(created.id, { body: 'Картой можно, через эквайринг' });

    const before = await prisma.feedback.findUnique({
      where: { id: created.id },
    });
    expect(before?.unreadForUser).toBe(1);

    const res = await getThread(created.id).expect(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBe(2);
    expect(res.body.messages[0].authorRole).toBe('USER');
    expect(res.body.messages[1].authorRole).toBe('ADMIN');
    expect(res.body.feedback.unreadForUser).toBe(0);

    const after = await prisma.feedback.findUnique({
      where: { id: created.id },
    });
    expect(after?.unreadForUser).toBe(0);
    expect(after?.userLastReadAt).not.toBeNull();
  });

  it('GET /feedback/:id чужому юзеру → 403', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Чужой доступ не должен работать',
    });
    await getThread(created.id, otherToken).expect(403);
  });

  it('GET /feedback/:id админом → 200 (админ не автор, но имеет доступ)', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Админский доступ к треду',
    });
    const res = await getThread(created.id, adminToken).expect(200);
    expect(res.body.feedback.id).toBe(created.id);
  });

  // ── Переписка: статусы и счётчики (§4.3) ──────────────────────────────

  it('ответ юзера → WAITING_ADMIN, unreadForAdmin++', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Первое сообщение',
    });

    const res = await postUserMsg(created.id, {
      body: 'Уточняю: нужен самовывоз',
    }).expect(201);

    expect(res.body.message.authorRole).toBe('USER');
    expect(res.body.feedback.status).toBe('WAITING_ADMIN');
    // 2 = первое сообщение треда (админ его ещё не читал) + это новое.
    expect(res.body.feedback.unreadForAdmin).toBe(2);
    expect(res.body.feedback.lastMessageBy).toBe('USER');
  });

  it('ответ админа → WAITING_USER, unreadForUser=1, автор уведомлён', async () => {
    const created = await createThread({
      type: 'QUESTION',
      message: 'Когда привезёте?',
    });

    const notifBefore = await prisma.notification.count({
      where: { userId: buyerId, type: 'feedback', relatedId: created.id },
    });

    const res = await postAdminMsg(created.id, {
      body: 'Доставка по Ижевску — 300 руб, в течение дня.',
    }).expect(201);

    expect(res.body.message.authorRole).toBe('ADMIN');
    expect(res.body.message.kind).toBe('TEXT');
    expect(res.body.feedback.status).toBe('WAITING_USER');
    expect(res.body.feedback.unreadForUser).toBe(1);
    expect(res.body.feedback.lastMessageBy).toBe('ADMIN');

    // Исполнитель назначается на первом реальном ответе админа.
    expect(res.body.feedback.assignedAdminId).toBe(adminId);

    const notifAfter = await prisma.notification.count({
      where: { userId: buyerId, type: 'feedback', relatedId: created.id },
    });
    expect(notifAfter).toBe(notifBefore + 1);
  });

  it('ответ юзера в закрытом треде переоткрывает его', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Закрытие и переоткрытие',
    });

    await request(app.getHttpServer())
      .post(`/feedback/${created.id}/close`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);

    let row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CLOSED');
    expect(row?.closedAt).not.toBeNull();

    await postUserMsg(created.id, { body: 'Вопрос снова актуален' }).expect(
      201,
    );

    row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('WAITING_ADMIN');
    expect(row?.closedAt).toBeNull();
  });

  // ── Внутренние заметки ────────────────────────────────────────────────

  it('kind=NOTE: юзеру не видна, статус не меняет, счётчик не растит', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Обращение под внутреннюю заметку',
    });

    const lastMessageBefore = await prisma.feedback.findUnique({
      where: { id: created.id },
    });

    const res = await postAdminMsg(created.id, {
      body: 'Логисты сказали: за город +500',
      kind: 'NOTE',
    }).expect(201);

    expect(res.body.message.kind).toBe('NOTE');
    // Статус/lastMessageAt не тронуты — заметка внутренняя.
    expect(res.body.feedback.status).toBe('NEW');
    expect(res.body.feedback.unreadForUser).toBe(0);
    expect(res.body.feedback.lastMessageAt).toBe(
      lastMessageBefore?.lastMessageAt.toISOString(),
    );

    const asUser = await getThread(created.id).expect(200);
    const kinds = (asUser.body.messages as Array<{ kind: string }>).map(
      (m) => m.kind,
    );
    expect(kinds).not.toContain('NOTE');
    expect(kinds).toContain('TEXT');

    // Админу заметка видна.
    const asAdmin = await getThread(created.id, adminToken).expect(200);
    const adminKinds = (asAdmin.body.messages as Array<{ kind: string }>).map(
      (m) => m.kind,
    );
    expect(adminKinds).toContain('NOTE');

    // И счётчик непрочитанного у юзера на заметке не завис.
    const row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.unreadForUser).toBe(0);
  });

  it('kind со мусором → 400', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка валидации kind',
    });
    await postAdminMsg(created.id, { body: 'текст', kind: 'SYSTEM' }).expect(
      400,
    );
  });

  // ── Отметка прочитанным ───────────────────────────────────────────────

  it('PATCH /admin/feedback/:id/messages/:msgId/read сбрасывает флаг одного сообщения', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Сообщение для отметки прочитанным',
    });

    const sent = await postUserMsg(created.id, {
      body: 'Ещё вопрос от юзера',
    }).expect(201);

    // Непрочитанных у админа два: первое сообщение треда + это.
    const before = await prisma.feedback.findUnique({
      where: { id: created.id },
    });
    expect(before?.unreadForAdmin).toBe(2);

    const res = await request(app.getHttpServer())
      .patch(
        `/admin/feedback/${created.id}/messages/${sent.body.message.id}/read`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Эндпоинт отмечает ОДНО сообщение → остаётся непрочитанным первое.
    expect(res.body.unreadForAdmin).toBe(1);

    const msg = await prisma.feedbackMessage.findUnique({
      where: { id: sent.body.message.id },
    });
    expect(msg?.isReadByAdmin).toBe(true);

    // Явная отметка всего треда прочитанным добивает счётчик до нуля.
    const all = await request(app.getHttpServer())
      .post(`/feedback/${created.id}/read`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);
    expect(all.body.unreadForUser).toBe(0);
  });

  it('PATCH .../read под BUYER → 403', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Запрет на админский роут',
    });
    await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.id}/messages/whatever/read`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  // ── Права и валидация сообщений ───────────────────────────────────────

  it('POST /feedback/:id/messages чужому юзеру → 403, сообщение не создано', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Чужой не должен писать в тред',
    });

    const before = await prisma.feedbackMessage.count({
      where: { feedbackId: created.id },
    });

    await postUserMsg(created.id, { body: 'внедряюсь' }, otherToken).expect(
      403,
    );

    const after = await prisma.feedbackMessage.count({
      where: { feedbackId: created.id },
    });
    expect(after).toBe(before);
  });

  it('пустое тело сообщения → 400', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка пустого сообщения',
    });
    await postUserMsg(created.id, { body: '   ' }).expect(400);
    await postUserMsg(created.id, {}).expect(400);
  });

  it('тело длиннее 2000 → 400', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка длины сообщения',
    });
    await postUserMsg(created.id, { body: 'x'.repeat(2001) }).expect(400);
  });

  it('лишнее поле в сообщении → 400 (forbidNonWhitelisted)', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка лишнего поля',
    });
    await postUserMsg(created.id, { body: 'текст', surprise: 1 }).expect(400);
  });

  it('сообщение с телефоном не проходит модерацию → 400', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка модерации треда',
    });

    const before = await prisma.feedbackMessage.count({
      where: { feedbackId: created.id },
    });

    await postUserMsg(created.id, {
      body: 'давай созвонимся, мой номер 89123456789',
    }).expect(400);

    const after = await prisma.feedbackMessage.count({
      where: { feedbackId: created.id },
    });
    expect(after).toBe(before);
  });

  it('без токена на тред → 401', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Проверка отсутствия токена',
    });
    await request(app.getHttpServer())
      .get(`/feedback/${created.id}`)
      .expect(401);
  });

  // ── Списки, фильтры, статистика ───────────────────────────────────────

  it('GET /feedback/my отдаёт сводку треда (lastPreview, hasAiAnswer)', async () => {
    const res = await request(app.getHttpServer())
      .get('/feedback/my')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    const item = (res.body.items as Array<Record<string, unknown>>)[0];
    expect(item).toHaveProperty('lastPreview');
    expect(item).toHaveProperty('hasAiAnswer');
    expect(item).toHaveProperty('unreadForUser');
    expect(item).toHaveProperty('lastMessageAt');
  });

  it('GET /admin/feedback?unreadOnly=1 → только с непрочитанным у админа', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Непрочитанное обращение для фильтра',
    });

    const res = await request(app.getHttpServer())
      .get('/admin/feedback?unreadOnly=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const items = res.body.items as Array<{
      id: string;
      unreadForAdmin: number;
    }>;
    expect(items.every((f) => f.unreadForAdmin > 0)).toBe(true);
    expect(items.some((f) => f.id === created.id)).toBe(true);
  });

  it('GET /admin/feedback?q= ищет по теме треда', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Текст без ключевого слова',
      subject: 'УникальнаяТемаПроверки',
    });

    const res = await request(app.getHttpServer())
      .get('/admin/feedback?q=УникальнаяТемаПроверки')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(created.id);
  });

  it('GET /admin/feedback/stats → форма сводки', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/feedback/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(typeof res.body.new).toBe('number');
    expect(typeof res.body.waitingAdmin).toBe('number');
    expect(typeof res.body.unread).toBe('number');
    expect(typeof res.body.avgFirstResponseMin).toBe('number');
    expect(typeof res.body.aiResolvedPercent).toBe('number');
  });

  it('GET /admin/feedback/stats под BUYER → 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/feedback/stats')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('GET /admin/feedback/:id отдаёт тред с автором и исполнителем', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Админский тред целиком',
    });
    await postAdminMsg(created.id, { body: 'Беру в работу' });

    const res = await request(app.getHttpServer())
      .get(`/admin/feedback/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.feedback.user?.id).toBe(buyerId);
    expect(res.body.feedback.assignedAdmin?.id).toBe(adminId);
    expect(res.body.messages.length).toBe(2);
  });

  // ── Троттлинг уведомлений админам (§4.5 п.5) ──────────────────────────

  it('два сообщения юзера подряд → админам уходит только одно уведомление', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Тред под троттлинг уведомлений',
    });

    const countFor = () =>
      prisma.notification.count({
        where: { userId: adminId, relatedId: created.id },
      });

    // О создании тред уведомляет всех админов (счётчик должен быть > 0).
    const before = await countFor();
    expect(before).toBeGreaterThan(0);

    await postUserMsg(created.id, {
      body: 'первое сообщение подряд',
    }).expect(201);
    const afterFirst = await countFor();
    await postUserMsg(created.id, {
      body: 'второе сообщение сразу же',
    }).expect(201);
    const afterSecond = await countFor();

    // Первое — уведомило (не затронуто троттлингом от создания, у которого
    // ключ пуст). Второе — подавлено: окно 10 минут на тред.
    expect(afterFirst).toBeGreaterThan(before);
    expect(afterSecond).toBe(afterFirst);
  });

  // ── Автозакрытие (§4.3, FR-1.8) ───────────────────────────────────────

  it('WAITING_USER старше 7 дней закрывается кроном', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Тред для автозакрытия',
    });
    await postAdminMsg(created.id, { body: 'Ответили, ждём юзера' });

    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.feedback.update({
      where: { id: created.id },
      data: { status: 'WAITING_USER', lastMessageAt: stale },
    });

    const closed = await feedbackService.autoCloseStaleThreads();
    expect(closed).toBeGreaterThan(0);

    const row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CLOSED');
    expect(row?.closedAt).not.toBeNull();
  });

  it('свежий WAITING_USER крон не трогает', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Свежий тред не должен закрыться',
    });
    await postAdminMsg(created.id, { body: 'Ждём ответа юзера' });

    await feedbackService.autoCloseStaleThreads();

    const row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('WAITING_USER');
    expect(row?.closedAt).toBeNull();
  });

  // ── PATCH: назначение исполнителя и CLOSED ────────────────────────────

  it('PATCH /admin/feedback/:id назначает исполнителя', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Тред под назначение исполнителя',
    });

    const res = await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedAdminId: adminId, status: 'IN_PROGRESS' })
      .expect(200);

    expect(res.body.assignedAdminId).toBe(adminId);
    expect(res.body.status).toBe('IN_PROGRESS');

    const cleared = await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedAdminId: null })
      .expect(200);
    expect(cleared.body.assignedAdminId).toBeNull();
  });

  it('PATCH status=CLOSED проставляет closedAt', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Тред под закрытие через PATCH',
    });

    await request(app.getHttpServer())
      .patch(`/admin/feedback/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLOSED' })
      .expect(200);

    const row = await prisma.feedback.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CLOSED');
    expect(row?.closedAt).not.toBeNull();
  });

  it('POST /admin/feedback/:id/close под BUYER → 403', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Админский close недоступен юзеру',
    });
    await request(app.getHttpServer())
      .post(`/admin/feedback/${created.id}/close`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('POST /feedback/:id/close чужому юзеру → 403', async () => {
    const created = await createThread({
      type: 'OTHER',
      message: 'Чужое закрытие запрещено',
    });
    await request(app.getHttpServer())
      .post(`/feedback/${created.id}/close`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('POST /feedback/:id/messages на несуществующий тред → 404', async () => {
    await postUserMsg('00000000-0000-0000-0000-000000000000', {
      body: 'треда нет',
    }).expect(404);
  });
});
