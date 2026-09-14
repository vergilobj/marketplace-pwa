/**
 * ЭТАП 2 ТЗ «ИИ-консультант» — интеграционный e2e.
 *
 * РЕАЛЬНАЯ БД (изолированная `marketplace_test`) + РЕАЛЬНЫЕ HTTP-запросы.
 * ЕДИНСТВЕННЫЙ мок — `BazarApiClient`: реальный LLM (Hermes API :8642)
 * в тестах не зовётся НИКОГДА (требование задания + внешний оркестратор
 * 89.167.0.215:8002 не должен получать ни одного запроса).
 *
 * Что проверяем (то, что нельзя доказать юнитом с моком Prisma):
 *   - вопрос → ответ ИИ, статус треда AI_HANDLED, запись в ConsultLog;
 *   - фолбэк: LLM вернул {"unknown": true} → тред создан автоматически,
 *     ответ записан в FeedbackMessage с kind=AI_ANSWER, юзер получил feedbackId;
 *   - выключенный консультант → 503 {enabled:false};
 *   - rate limit → 429;
 *   - пустой/слишком короткий вопрос → 400;
 *   - чужой лог оценки → 400 (ownership);
 *   - аноним (без токена) → 401;
 *   - история /consult/history отдаёт только свои вопросы;
 *   - /consult/call-admin создаёт тред;
 *   - антигаллюцинация: выдуманная цена в ответе LLM вырезается.
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
import { BazarApiClient } from '../src/bazar/bazar.api-client';
import { SettingsService } from '../src/settings/settings.service';
import { cleanupTestData } from '../src/common/prisma/test-db-cleanup';
import { __resetKnowledgeTableCache } from '../src/consult/knowledge-search.service';

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

/** Namespace этой спеки (зарегистрирован в ALL_TEST_PHONE_PREFIXES). */
const PREFIX = 'cst-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Ответ, который «отдаёт LLM» по умолчанию. */
const LLM_ANSWER =
  'Да, самовывоз возможен — со склада на Пушкина 107А, по будням с 10 до 19.';

describe('ИИ-консультант (integration): /consult/*', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let settings: SettingsService;

  /** Мок транспорта к LLM: сюда пишем, что «ответила модель». */
  const llm = {
    text: LLM_ANSWER,
    shouldFail: false,
    calls: 0,
    lastPrompt: '' as string,
    lastOpts: undefined as { temperature?: number; sessionKey?: string } | undefined,
  };

  const userIds: string[] = [];
  const productIds: string[] = [];

  let buyerToken = '';
  let buyerId = '';
  let otherToken = '';
  let otherId = '';
  let adminToken = '';
  let adminId = '';
  /**
   * Отдельный юзер ТОЛЬКО под тест rate-limit: лимит считается по ConsultLog
   * за час, а другие тесты этой же спеки уже задавали вопросы. Общий юзер
   * сделал бы тест зависимым от порядка выполнения.
   */
  let rlToken = '';

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `CST ${tag}`,
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

  const ask = (body: unknown, token = buyerToken) =>
    request(app.getHttpServer())
      .post('/consult/ask')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // ЕДИНСТВЕННЫЙ мок: реальный LLM в тестах не вызывается.
      .overrideProvider(BazarApiClient)
      .useValue({
        complete: jest.fn(
          async (
            messages: { role: string; content: string }[],
            opts?: { temperature?: number; sessionKey?: string },
          ) => {
            llm.calls += 1;
            llm.lastPrompt = messages?.[0]?.content ?? '';
            llm.lastOpts = opts;
            if (llm.shouldFail) throw new Error('bazar_unreachable');
            return { text: llm.text };
          },
        ),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    settings = app.get(SettingsService);

    const buyer = await mkUser('buyer', UserRole.BUYER);
    buyerId = buyer.id;
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);

    const other = await mkUser('other', UserRole.BUYER);
    otherId = other.id;
    otherToken = tokenFor(other.id, other.phone, UserRole.BUYER);

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminId = admin.id;
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);

    const rl = await mkUser('rl', UserRole.BUYER);
    rlToken = tokenFor(rl.id, rl.phone, UserRole.BUYER);

    // Товар для товарного контекста (продавец — «другой» юзер).
    const product = await prisma.product.create({
      data: {
        title: `CST товар ${SUFFIX}`,
        description: 'Товар для проверки консультанта',
        price: 1500,
        media: [],
        sellerId: otherId,
        isActive: true,
      },
    });
    productIds.push(product.id);
  });

  afterAll(async () => {
    await cleanupTestData(
      prisma,
      { userIds, productIds },
      { prefixes: [PREFIX] },
    );
    await app.close();
  });

  beforeEach(async () => {
    llm.text = LLM_ANSWER;
    llm.shouldFail = false;
    llm.calls = 0;
    llm.lastPrompt = '';
    llm.lastOpts = undefined;
    __resetKnowledgeTableCache();
    // Настройки — в дефолт: тесты не должны зависеть от порядка выполнения.
    await settings.set('consult_enabled', 'true');
    await settings.set('consult_confidence_threshold', '0.45');
    await settings.set('consult_hint_threshold', '0.25');
    await settings.set('consult_rate_limit_per_hour', '20');
    await settings.set('consult_max_ai_turns', '5');
    await settings.set('consult_product_context', 'true');
  });

  // ── Вопрос → ответ ────────────────────────────────────────────────────

  it('POST /consult/ask отвечает и логирует ответ (source=LLM)', async () => {
    const res = await ask({ text: 'А самовывоз у вас есть?' }).expect(201);

    expect(res.body.answer).toBe(LLM_ANSWER);
    expect(res.body.source).toBe('LLM');
    expect(res.body.askAdmin).toBe(false);
    expect(typeof res.body.confidence).toBe('number');
    expect(res.body.logId).toBeTruthy();

    const log = await prisma.consultLog.findUnique({
      where: { id: res.body.logId },
    });
    expect(log?.userId).toBe(buyerId);
    expect(log?.question).toBe('А самовывоз у вас есть?');
    expect(log?.source).toBe('LLM');
    expect(log?.feedbackId).toBeNull();
    expect(log?.latencyMs).toBeGreaterThanOrEqual(0);

    // Историю пишем в BazarMessage с meta.kind='consult' (§5.2 ШАГ 6).
    const history = await prisma.bazarMessage.findMany({
      where: { userId: buyerId },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(
      history.some(
        (m) =>
          (m.meta as { kind?: string } | null)?.kind === 'consult' &&
          m.role === 'ASSISTANT',
      ),
    ).toBe(true);
  });

  it('sessionKey консультанта изолирован как ${userId}_consult', async () => {
    await ask({ text: 'Вопрос про гарантию' }).expect(201);
    expect(llm.lastOpts?.sessionKey).toBe(`${buyerId}_consult`);
  });

  it('товарный вопрос тянет товарный контекст в промпт', async () => {
    const product = await prisma.product.findFirst({
      where: { id: { in: productIds } },
    });
    const res = await ask({
      text: 'Сколько стоит этот товар?',
      productId: product?.id,
    }).expect(201);

    expect(res.body.askAdmin).toBe(false);
    // Товарный контекст попал в промпт (проверяем сам промпт, а не догадки).
    expect(llm.lastPrompt).toContain('product');
    expect(llm.lastPrompt).toContain('1500');
  });

  // ── Фолбэк → автосоздание треда ───────────────────────────────────────

  it('LLM не уверен ({"unknown": true}) → фолбэк + автосозданный тред', async () => {
    llm.text = '{"unknown": true}';

    const res = await ask({
      text: 'А вы работаете с юрлицами по безналу с отсрочкой платежа?',
    }).expect(201);

    expect(res.body.source).toBe('FALLBACK');
    expect(res.body.askAdmin).toBe(true);
    expect(res.body.feedbackId).toBeTruthy();
    expect(res.body.answer).toContain('администратор');

    const thread = await prisma.feedback.findUnique({
      where: { id: res.body.feedbackId },
      include: { messages: true },
    });
    expect(thread?.userId).toBe(buyerId);
    expect(thread?.type).toBe('CONSULTATION');
    expect(thread?.source).toBe('CONSULT');
    expect(thread?.status).toBe('WAITING_ADMIN');

    // Ответ ИИ лежит в треде как AI_ANSWER (FR-2.2), автор — AI.
    const aiMessage = thread?.messages.find((m) => m.kind === 'AI_ANSWER');
    expect(aiMessage).toBeTruthy();
    expect(aiMessage?.authorRole).toBe('AI');
    expect(aiMessage?.authorId).toBeNull();

    // В логе — ссылка на созданный тред, source=FALLBACK.
    const log = await prisma.consultLog.findUnique({
      where: { id: res.body.logId },
    });
    expect(log?.source).toBe('FALLBACK');
    expect(log?.feedbackId).toBe(res.body.feedbackId);
  });

  it('LLM недоступен → фолбэк, а не 500', async () => {
    llm.shouldFail = true;

    const res = await ask({ text: 'Упадёт ли консультант при недоступном LLM?' }).expect(
      201,
    );

    expect(res.body.source).toBe('FALLBACK');
    expect(res.body.askAdmin).toBe(true);
    expect(res.body.feedbackId).toBeTruthy();
  });

  it('повторный фолбэк дописывается в тот же свежий тред, а не плодит новые', async () => {
    llm.text = '{"unknown": true}';

    const first = await ask({
      text: 'Первый вопрос без ответа у меня в голове',
    }).expect(201);
    const second = await ask({
      text: 'Второй вопрос подряд про то же самое',
    }).expect(201);

    expect(second.body.feedbackId).toBe(first.body.feedbackId);
  });

  // ── Права ─────────────────────────────────────────────────────────────

  it('без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/consult/ask')
      .send({ text: 'анонимный вопрос' })
      .expect(401);
  });

  it('GET /consult/history отдаёт только свои вопросы', async () => {
    await ask({ text: 'Мой уникальный вопрос номер один' }).expect(201);
    await ask({ text: 'Чужой вопрос' }, otherToken).expect(201);

    const res = await request(app.getHttpServer())
      .get('/consult/history')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    const questions = (res.body.items as { question: string }[]).map(
      (i) => i.question,
    );
    expect(questions).toContain('Мой уникальный вопрос номер один');
    expect(questions).not.toContain('Чужой вопрос');
  });

  it('GET /consult/history без токена → 401', async () => {
    await request(app.getHttpServer()).get('/consult/history').expect(401);
  });

  it('POST /consult/:logId/rate чужого лога → 400 (ownership)', async () => {
    const mine = await ask({ text: 'Вопрос для оценки полезности' }).expect(201);

    await request(app.getHttpServer())
      .post(`/consult/${mine.body.logId}/rate`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ helpful: true })
      .expect(400);

    // Свой — можно, и флаг реально сохраняется.
    const ok = await request(app.getHttpServer())
      .post(`/consult/${mine.body.logId}/rate`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ helpful: true })
      .expect(201);
    expect(ok.body.helpful).toBe(true);
  });

  it('POST /consult/:logId/rate без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/consult/00000000-0000-0000-0000-000000000000/rate')
      .send({ helpful: true })
      .expect(401);
  });

  // ── Настройки §5.6 ────────────────────────────────────────────────────

  it('consult_enabled=false → 503 {enabled:false}', async () => {
    await settings.set('consult_enabled', 'false');

    const res = await ask({ text: 'Консультант выключен — что будет?' }).expect(
      503,
    );
    expect(res.body.enabled).toBe(false);

    await settings.set('consult_enabled', 'true');
  });

  it('rate limit: больше N вопросов в час → 429', async () => {
    await settings.set('consult_rate_limit_per_hour', '2');

    await ask({ text: 'Первый вопрос под лимит' }, rlToken).expect(201);
    await ask({ text: 'Второй вопрос под лимит' }, rlToken).expect(201);
    await ask({ text: 'Третий вопрос уже сверх лимита' }, rlToken).expect(429);

    await settings.set('consult_rate_limit_per_hour', '20');
  });

  it('после consult_max_ai_turns ответов ИИ предлагает позвать админа', async () => {
    await settings.set('consult_max_ai_turns', '1');

    // Первый вопрос — ИИ отвечает, turns становится 1.
    await ask({ text: 'Первый вопрос до предложения админа' }).expect(201);
    // Второй — turns уже >= maxTurns, в подсказках появляется админ.
    const res = await ask({ text: 'Второй вопрос до предложения админа' }).expect(
      201,
    );

    expect(res.body.suggestions).toContain('Позвать администратора');
    await settings.set('consult_max_ai_turns', '5');
  });

  // ── Валидация ─────────────────────────────────────────────────────────

  it('слишком короткий вопрос → 400', async () => {
    await ask({ text: 'ок' }).expect(400);
  });

  it('пустой вопрос → 400', async () => {
    await ask({ text: '' }).expect(400);
    await ask({}).expect(400);
  });

  it('вопрос длиннее 2000 → 400', async () => {
    await ask({ text: 'x'.repeat(2001) }).expect(400);
  });

  it('лишнее поле → 400 (forbidNonWhitelisted)', async () => {
    await ask({ text: 'Нормальный вопрос', surprise: 1 }).expect(400);
  });

  it('вопрос с телефоном не проходит модерацию → 400', async () => {
    const before = await prisma.consultLog.count({ where: { userId: buyerId } });

    await ask({
      text: 'давай созвонимся, мой номер 89123456789',
    }).expect(400);

    const after = await prisma.consultLog.count({ where: { userId: buyerId } });
    expect(after).toBe(before);
  });

  // ── call-admin ────────────────────────────────────────────────────────

  it('POST /consult/call-admin создаёт тред', async () => {
    const res = await request(app.getHttpServer())
      .post('/consult/call-admin')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ text: 'Позовите админа, пожалуйста' })
      .expect(201);

    expect(res.body.created).toBe(true);
    expect(res.body.feedbackId).toBeTruthy();

    const thread = await prisma.feedback.findUnique({
      where: { id: res.body.feedbackId },
    });
    expect(thread?.userId).toBe(buyerId);
    expect(thread?.type).toBe('CONSULTATION');
    expect(thread?.source).toBe('CONSULT');
    expect(thread?.status).toBe('WAITING_ADMIN');
  });

  it('POST /consult/call-admin с чужим feedbackId создаёт свой тред, а не 403', async () => {
    const foreign = await prisma.feedback.create({
      data: {
        userId: otherId,
        type: 'OTHER',
        message: 'Чужой тред',
        status: 'NEW',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/consult/call-admin')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ feedbackId: foreign.id })
      .expect(201);

    expect(res.body.created).toBe(true);
    expect(res.body.feedbackId).not.toBe(foreign.id);
  });

  it('POST /consult/call-admin без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/consult/call-admin')
      .send({ text: 'аноним зовёт админа' })
      .expect(401);
  });

  // ── Антигаллюцинации ──────────────────────────────────────────────────

  it('выдуманная цена в ответе LLM вырезается (§5.2 ШАГ 4)', async () => {
    const product = await prisma.product.findFirst({
      where: { id: { in: productIds } },
    });

    // Товар стоит 1500; модель «решила», что 9999.
    llm.text = 'Этот товар стоит 9999 руб, отличная цена!';

    const res = await ask({
      text: 'Сколько стоит этот товар?',
      productId: product?.id,
    }).expect(201);

    expect(res.body.answer).not.toContain('9999');
    expect(res.body.answer).toContain('администратора');
  });

  it('совпадающая с БД цена не вырезается', async () => {
    const product = await prisma.product.findFirst({
      where: { id: { in: productIds } },
    });

    llm.text = 'Товар стоит 1500 руб, можно забрать сегодня.';

    const res = await ask({
      text: 'Сколько стоит этот товар?',
      productId: product?.id,
    }).expect(201);

    expect(res.body.answer).toContain('1500');
  });

  // ── База знаний (Этап 3): поиск подключён к таблице ───────────────────

  it('таблица базы знаний существует и поиск не мешает ответу', async () => {
    // ЭТАП 3 создал KnowledgeEntry миграцией 20260914130000_knowledge_base.
    // Здесь проверяем ИНТЕГРАЦИЮ: поиск видит таблицу и, не найдя совпадений,
    // не ломает обычный ответ консультанта.
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'KnowledgeEntry'`,
    );
    expect(tables.length).toBe(1);

    const res = await ask({ text: 'Вопрос при пустой базе знаний' }).expect(
      201,
    );
    expect(res.body.source).not.toBe('KNOWLEDGE');
    expect(res.body.answer).toBeTruthy();
  });

  // ── Тред: ответ ИИ виден в feedback-треде ─────────────────────────────

  it('ответ ИИ в треде не растит unreadForAdmin и не шлёт пуш автору', async () => {
    llm.text = '{"unknown": true}';

    const res = await ask({
      text: 'Вопрос в тред для проверки уведомлений',
    }).expect(201);

    const thread = await prisma.feedback.findUnique({
      where: { id: res.body.feedbackId },
      include: { messages: true },
    });

    // AI-сообщение не считается непрочитанным у админа (§4.3).
    const aiMsg = thread?.messages.find((m) => m.kind === 'AI_ANSWER');
    expect(aiMsg?.isReadByAdmin).toBe(true);

    // Пуш автору о собственном вопросе не уходит.
    const pushesToAuthor = await prisma.notification.count({
      where: { userId: buyerId, relatedId: res.body.feedbackId },
    });
    expect(pushesToAuthor).toBe(0);

    // Админ при этом уведомлён о новом треде (иначе фолбэк бессмыслен).
    const adminNotifs = await prisma.notification.count({
      where: { userId: adminId, relatedId: res.body.feedbackId },
    });
    expect(adminNotifs).toBeGreaterThan(0);
  });
});