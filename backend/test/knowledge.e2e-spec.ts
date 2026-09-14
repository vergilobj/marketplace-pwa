/**
 * ЭТАП 3 ТЗ «База знаний + обучение на ответах админов» — интеграционный e2e.
 *
 * РЕАЛЬНАЯ БД (изолированная `marketplace_test`) + РЕАЛЬНЫЕ HTTP-запросы.
 * ЕДИНСТВЕННЫЙ мок — `BazarApiClient`: реальный LLM (Hermes API :8642) в
 * тестах не зовётся НИКОГДА (требование задания + внешний оркестратор
 * 89.167.0.215:8002 не должен получать ни одного запроса).
 *
 * Что проверяем (то, что нельзя доказать юнитом с моком Prisma):
 *   - создание знания + нормализация вопроса (questionNorm пишется);
 *   - поиск НАХОДИТ знание и консультант отвечает из базы (source=KNOWLEDGE,
 *     LLM не вызывается) — главный смысл этапа;
 *   - usageCount++ и lastUsedAt при ответе из знания;
 *   - оценка «Помогло?» поднимает helpfulCount/notHelpfulCount знания;
 *   - ПУТЬ A: ответ админа в треде → кандидат PENDING;
 *   - одобрение кандидата С ОТРЕДАКТИРОВАННОЙ формулировкой (FR-3.2) →
 *     ACTIVE-знание, которое сразу находится поиском;
 *   - отклонение кандидата;
 *   - дедупликация: похожее знание → 409;
 *   - права: юзер → 403, аноним → 401;
 *   - архивация (мягкое удаление) и смена статуса;
 *   - предпросмотр поиска отдаёт ветку §5.2;
 *   - статистика отдаёт счётчики и топ фолбэков.
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
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { __resetTrgmCache } from '../src/knowledge/knowledge.service';
import { normalize } from '../src/consult/knowledge-normalizer';

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
const PREFIX = 'kno-';
const SUFFIX = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Вопрос-эталон: им проверяем и точное совпадение, и триграммы. */
const Q_DELIVERY = 'Сколько стоит доставка по Ижевску';
const A_DELIVERY = 'Доставка по Ижевску — 300 руб, в течение дня.';

/** Ответ, который «отдаёт LLM», если его всё-таки спросят. */
const LLM_ANSWER = 'Уточните, пожалуйста, у администратора — он ответит точно.';

describe('База знаний (integration): /admin/knowledge/*', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let settings: SettingsService;

  const llm = {
    text: LLM_ANSWER,
    calls: 0,
    lastPrompt: '' as string,
  };

  const userIds: string[] = [];

  let adminToken = '';
  let adminId = '';
  let buyerToken = '';
  let buyerId = '';

  /** Знания, созданные этой спекой (чистим явно — таблица без FK на User). */
  const knowledgeIds: string[] = [];
  const candidateIds: string[] = [];

  const mkUser = async (tag: string, role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${tag}`,
        name: `KNO ${tag}`,
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

  const createKnowledge = (body: unknown, token = adminToken) =>
    request(app.getHttpServer())
      .post('/admin/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const approveCandidate = (
    candidateId: string,
    body: unknown,
    token = adminToken,
  ) =>
    request(app.getHttpServer())
      .post(`/admin/knowledge/from-candidate/${candidateId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const ask = (body: unknown, token = buyerToken) =>
    request(app.getHttpServer())
      .post('/consult/ask')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  /**
   * Уникальная формулировка.
   *
   * ⚠️ Общий для всей спеки SUFFIX в вопросе — ЛОВУШКА: trgm сравнивает
   * строки целиком, и длинный одинаковый хвост делает похожими даже совсем
   * разные вопросы (дедупликация честно вернёт 409, а поиск найдёт чужое).
   * Поэтому каждое знание получает свой случайный токен, а не общий хвост.
   */
  const uniqQ = (base: string) =>
    `${base} ${Math.random().toString(36).slice(2, 12)}`;

  /** Токен namespace'а — по нему находим и вычищаем мусор прошлых прогонов. */
  const NS_TOKEN = SUFFIX;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // ЕДИНСТВЕННЫЙ мок: реальный LLM в тестах не вызывается.
      .overrideProvider(BazarApiClient)
      .useValue({
        complete: jest.fn(
          async (messages: { role: string; content: string }[]) => {
            llm.calls += 1;
            llm.lastPrompt = messages?.[0]?.content ?? '';
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

    const admin = await mkUser('admin', UserRole.ADMIN);
    adminId = admin.id;
    adminToken = tokenFor(admin.id, admin.phone, UserRole.ADMIN);

    const buyer = await mkUser('buyer', UserRole.BUYER);
    buyerId = buyer.id;
    buyerToken = tokenFor(buyer.id, buyer.phone, UserRole.BUYER);

    // Уборка мусора прошлых (в т.ч. упавших) прогонов: у KnowledgeEntry нет
    // FK на User, поэтому cleanupTestData её не видит. Чистим только СВОЙ
    // namespace (kno-), чтобы не задеть данные соседних спек.
    await prisma.knowledgeCandidate.deleteMany({
      where: { answerDraft: { contains: PREFIX } },
    });
    await prisma.knowledgeEntry.deleteMany({
      where: { question: { contains: NS_TOKEN } },
    });
    await prisma.knowledgeEntry.deleteMany({
      where: { answer: { contains: PREFIX } },
    });
  });

  afterAll(async () => {
    // Знания/кандидаты — без FK на User, поэтому чистим явно.
    if (candidateIds.length) {
      await prisma.knowledgeCandidate
        .deleteMany({ where: { id: { in: candidateIds } } })
        .catch(() => undefined);
    }
    await prisma.knowledgeEntry
      .deleteMany({ where: { createdById: adminId } })
      .catch(() => undefined);
    if (knowledgeIds.length) {
      await prisma.knowledgeEntry
        .deleteMany({ where: { id: { in: knowledgeIds } } })
        .catch(() => undefined);
    }
    await cleanupTestData(prisma, { userIds }, { prefixes: [PREFIX] });
    await app.close();
  });

  beforeEach(async () => {
    llm.text = LLM_ANSWER;
    llm.calls = 0;
    llm.lastPrompt = '';
    __resetKnowledgeTableCache();
    __resetTrgmCache();
    await settings.set('consult_enabled', 'true');
    await settings.set('consult_confidence_threshold', '0.45');
    await settings.set('consult_hint_threshold', '0.25');
    await settings.set('consult_rate_limit_per_hour', '20');
    await settings.set('consult_product_context', 'false');
  });

  // ── Таблица и миграция ────────────────────────────────────────────────

  it('таблица KnowledgeEntry существует (миграция применена)', async () => {
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('KnowledgeEntry', 'KnowledgeCandidate')
        ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      'KnowledgeCandidate',
      'KnowledgeEntry',
    ]);
  });

  // ── Создание знания и нормализация ────────────────────────────────────

  it('POST /admin/knowledge создаёт знание и считает questionNorm', async () => {
    // Знак вопроса и общий токен ставим в СЕРЕДИНУ, а не в хвост: так
    // проверяем и нормализацию пунктуации, и что хвост-мусор не мешает.
    const question = `Сколько стоит доставка по Ижевску? ${uniqQ('').trim()}`;
    const res = await createKnowledge({
      question,
      answer: A_DELIVERY,
      category: 'доставка',
      tags: ['доставка', 'ижевск'],
    }).expect(201);

    knowledgeIds.push(res.body.id);

    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.source).toBe('ADMIN');
    // Нормализация: lower, без пунктуации, без стоп-слов («сколько», «по»).
    expect(res.body.questionNorm).toBe(normalize(question));
    expect(res.body.questionNorm).not.toContain('?');
    // Стоп-слова («по») выброшены, значимые слова остались.
    expect(res.body.questionNorm.split(' ')).not.toContain('по');
    expect(res.body.questionNorm).toContain('доставка');
    expect(res.body.usageCount).toBe(0);
    expect(res.body.helpfulRatio).toBeGreaterThan(0);

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: res.body.id },
    });
    expect(row?.questionNorm).toBe(normalize(question));
    expect(row?.createdById).toBe(adminId);
  });

  it('вопрос из одних стоп-слов не создаётся → 400', async () => {
    await createKnowledge({ question: 'а можно ли', answer: 'Да' }).expect(400);
  });

  it('создание знания без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/admin/knowledge')
      .send({ question: uniqQ('Любой вопрос'), answer: 'Любой ответ' })
      .expect(401);
  });

  it('создание знания юзером → 403', async () => {
    await createKnowledge(
      { question: uniqQ('Вопрос от юзера'), answer: 'Нельзя' },
      buyerToken,
    ).expect(403);
  });

  // ── Поиск: главный смысл этапа ────────────────────────────────────────

  it('поиск находит знание, консультант отвечает из базы и НЕ зовёт LLM', async () => {
    const question = uniqQ('Как оформить возврат товара');
    const answer = 'Возврат оформляется в течение 14 дней через раздел «Мои заказы».';
    const created = await createKnowledge({ question, answer }).expect(201);
    knowledgeIds.push(created.body.id);

    // Вопрос юзера — «кривой» вариант того же вопроса.
    const asked = question
      .replace('Как оформить', 'а как мне оформить')
      .replace('товара', 'товара??');

    const res = await ask({ text: asked }).expect(201);

    expect(res.body.source).toBe('KNOWLEDGE');
    expect(res.body.answer).toBe(answer);
    expect(res.body.knowledgeId).toBe(created.body.id);
    expect(res.body.askAdmin).toBe(false);
    // LLM не вызывался: ответ целиком из базы знаний (§5.2 ШАГ 3).
    expect(llm.calls).toBe(0);

    const log = await prisma.consultLog.findUnique({
      where: { id: res.body.logId },
    });
    expect(log?.source).toBe('KNOWLEDGE');
    expect(log?.knowledgeId).toBe(created.body.id);
  });

  it('ответ из базы знаний растит usageCount и ставит lastUsedAt', async () => {
    const question = uniqQ('Можно ли оплатить при получении');
    const created = await createKnowledge({
      question,
      answer: 'Да, оплата при получении доступна.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    await ask({ text: question }).expect(201);
    await ask({ text: question }).expect(201);

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.usageCount).toBe(2);
    expect(row?.lastUsedAt).toBeTruthy();
  });

  it('answerShort имеет приоритет в ответе консультанта', async () => {
    const question = uniqQ('Работаете ли вы в воскресенье');
    const created = await createKnowledge({
      question,
      answer: 'Полный ответ: работаем по субботам, в воскресенье — выходной.',
      answerShort: 'В воскресенье не работаем.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    const res = await ask({ text: question }).expect(201);
    expect(res.body.source).toBe('KNOWLEDGE');
    expect(res.body.answer).toBe('В воскресенье не работаем.');
  });

  it('неизвестный вопрос НЕ находит знание (source != KNOWLEDGE)', async () => {
    await createKnowledge({
      question: uniqQ('Есть ли самовывоз со склада'),
      answer: 'Да, самовывоз есть.',
    }).expect(201);

    const res = await ask({
      text: 'А вы работаете с юрлицами по безналу с отсрочкой платежа?',
    }).expect(201);

    expect(res.body.source).not.toBe('KNOWLEDGE');
  });

  // ── Оценка полезности (§5.5 №15 + §6.3) ───────────────────────────────

  it('«Помогло? Да/Нет» обновляет helpfulCount/notHelpfulCount знания', async () => {
    const question = uniqQ('Какой срок доставки по России');
    const created = await createKnowledge({
      question,
      answer: 'По России — от 3 до 7 дней.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    const first = await ask({ text: question }).expect(201);
    const second = await ask({ text: question }).expect(201);
    expect(first.body.knowledgeId).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/consult/${first.body.logId}/rate`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ helpful: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/consult/${second.body.logId}/rate`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ helpful: false })
      .expect(201);

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.helpfulCount).toBe(1);
    expect(row?.notHelpfulCount).toBe(1);
  });

  // ── ПУТЬ A: ответ админа → кандидат → знание ──────────────────────────

  it('ответ админа в треде создаёт кандидата PENDING и флаг для фронта', async () => {
    // Тред создаём через API: тогда в нём есть настоящее сообщение юзера,
    // и questionDraft действительно берётся из вопроса, а не из темы.
    const created = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        type: 'QUESTION',
        message: 'А сколько идёт доставка в другой город?',
        subject: 'Доставка в другой город',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/admin/feedback/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'В другой город — от 500 руб, 2-4 дня.', kind: 'TEXT' })
      .expect(201);

    // Флаг для плашки «Сохранить как знание?» (§6.1 ПУТЬ A).
    expect(res.body.knowledgeCandidate).toBeTruthy();
    expect(res.body.knowledgeCandidate.status).toBe('PENDING');
    candidateIds.push(res.body.knowledgeCandidate.id);

    const candidate = await prisma.knowledgeCandidate.findUnique({
      where: { id: res.body.knowledgeCandidate.id },
    });
    expect(candidate?.feedbackId).toBe(created.body.id);
    expect(candidate?.messageId).toBe(res.body.message.id);
    expect(candidate?.answerDraft).toBe('В другой город — от 500 руб, 2-4 дня.');
    // questionDraft — вопрос юзера КАК ЕСТЬ (кривой ключ, админ поправит).
    expect(candidate?.questionDraft).toBe('А сколько идёт доставка в другой город?');
  });

  it('внутренняя заметка (kind=NOTE) кандидата НЕ создаёт', async () => {
    const thread = await prisma.feedback.create({
      data: {
        userId: buyerId,
        type: 'QUESTION',
        message: `Вопрос для заметки ${SUFFIX}`,
        status: 'NEW',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/feedback/${thread.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Внутренняя заметка, юзеру не видна', kind: 'NOTE' })
      .expect(201);

    expect(res.body.knowledgeCandidate).toBeUndefined();

    const count = await prisma.knowledgeCandidate.count({
      where: { feedbackId: thread.id },
    });
    expect(count).toBe(0);
  });

  it('одобрение кандидата с ОТРЕДАКТИРОВАННЫМ вопросом создаёт знание, которое сразу находится', async () => {
    const thread = await prisma.feedback.create({
      data: {
        userId: buyerId,
        type: 'QUESTION',
        // Кривой вопрос юзера — именно его нельзя брать ключом поиска (FR-3.2).
        message: `а скок гарантия?? ${SUFFIX}`,
        status: 'NEW',
      },
    });

    const posted = await request(app.getHttpServer())
      .post(`/admin/feedback/${thread.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Гарантия — 12 месяцев на всё.', kind: 'TEXT' })
      .expect(201);
    candidateIds.push(posted.body.knowledgeCandidate.id);

    // Админ правит формулировку вопроса — это и есть FR-3.2.
    const editedQuestion = uniqQ('Какая гарантия на товары');
    const approved = await approveCandidate(
      posted.body.knowledgeCandidate.id,
      { question: editedQuestion, category: 'гарантия' },
    ).expect(201);

    knowledgeIds.push(approved.body.knowledge.id);
    expect(approved.body.knowledge.question).toBe(editedQuestion);
    expect(approved.body.knowledge.questionNorm).toBe(
      normalize(editedQuestion),
    );
    expect(approved.body.knowledge.status).toBe('ACTIVE');
    expect(approved.body.knowledge.source).toBe('ADMIN');
    expect(approved.body.knowledge.sourceFeedbackId).toBe(thread.id);
    expect(approved.body.candidate.status).toBe('ACCEPTED');

    // Кандидат закрыт, знание привязано.
    const candidate = await prisma.knowledgeCandidate.findUnique({
      where: { id: posted.body.knowledgeCandidate.id },
    });
    expect(candidate?.status).toBe('ACCEPTED');
    expect(candidate?.knowledgeEntryId).toBe(approved.body.knowledge.id);

    // Знание сразу находится поиском по ОТРЕДАКТИРОВАННОЙ формулировке.
    const asked = await ask({ text: editedQuestion }).expect(201);
    expect(asked.body.source).toBe('KNOWLEDGE');
    expect(asked.body.answer).toBe('Гарантия — 12 месяцев на всё.');

    // В треде осталась служебная запись о сохранении в базу.
    const msg = await prisma.feedbackMessage.findFirst({
      where: { feedbackId: thread.id, kind: 'KNOWLEDGE' },
    });
    expect(msg).toBeTruthy();
  });

  it('отклонение кандидата не создаёт знание', async () => {
    const thread = await prisma.feedback.create({
      data: {
        userId: buyerId,
        type: 'QUESTION',
        message: `Вопрос на отклонение ${SUFFIX}`,
        status: 'NEW',
      },
    });

    const posted = await request(app.getHttpServer())
      .post(`/admin/feedback/${thread.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Ответ, который не пойдёт в базу.', kind: 'TEXT' })
      .expect(201);

    const reject = await request(app.getHttpServer())
      .post(
        `/admin/knowledge/candidates/${posted.body.knowledgeCandidate.id}/reject`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(reject.body.status).toBe('REJECTED');

    const candidate = await prisma.knowledgeCandidate.findUnique({
      where: { id: posted.body.knowledgeCandidate.id },
    });
    expect(candidate?.status).toBe('REJECTED');
    expect(candidate?.knowledgeEntryId).toBeNull();
  });

  it('GET /admin/knowledge/candidates отдаёт список ожидающих со связью на тред', async () => {
    const thread = await prisma.feedback.create({
      data: {
        userId: buyerId,
        type: 'QUESTION',
        message: `Вопрос для списка кандидатов ${SUFFIX}`,
        subject: 'Тема для кандидата',
        status: 'NEW',
      },
    });

    const posted = await request(app.getHttpServer())
      .post(`/admin/feedback/${thread.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Ответ для кандидата в списке.', kind: 'TEXT' })
      .expect(201);
    candidateIds.push(posted.body.knowledgeCandidate.id);

    const res = await request(app.getHttpServer())
      .get('/admin/knowledge/candidates')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const found = (res.body.items as { id: string; feedback?: unknown }[]).find(
      (c) => c.id === posted.body.knowledgeCandidate.id,
    );
    expect(found).toBeTruthy();
    expect(found?.feedback).toBeTruthy();
  });

  it('кандидат не создаётся для треда типа BUG (не знание)', async () => {
    const thread = await prisma.feedback.create({
      data: {
        userId: buyerId,
        type: 'BUG',
        message: `Кнопка не работает ${SUFFIX}`,
        status: 'NEW',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/feedback/${thread.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Починили, обновите страницу.', kind: 'TEXT' })
      .expect(201);

    expect(res.body.knowledgeCandidate).toBeUndefined();
  });

  // ── Дедупликация и правка ─────────────────────────────────────────────

  it('похожее знание → 409 с id существующего', async () => {
    // Формулировки ОБЯЗАНЫ совпадать: uniqQ() даёт свой токен на каждый вызов,
    // поэтому строку считаем один раз.
    const question = uniqQ('Сколько стоит сборка мебели на дому');
    const first = await createKnowledge({
      question,
      answer: 'Сборка — 1000 руб.',
    }).expect(201);
    knowledgeIds.push(first.body.id);

    const conflict = await createKnowledge({
      question,
      answer: 'Дубль.',
    }).expect(409);

    expect(conflict.body.duplicateId).toBe(first.body.id);
  });

  it('PATCH /admin/knowledge/:id с новым вопросом пересчитывает questionNorm', async () => {
    const created = await createKnowledge({
      question: uniqQ('Старая формулировка вопроса'),
      answer: 'Ответ остаётся.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    const newQuestion = uniqQ('Новая формулировка вопроса');
    const res = await request(app.getHttpServer())
      .patch(`/admin/knowledge/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ question: newQuestion })
      .expect(200);

    expect(res.body.question).toBe(newQuestion);
    expect(res.body.questionNorm).toBe(normalize(newQuestion));

    // Поиск идёт по НОВОМУ ключу: старая формулировка больше не находится
    // точным совпадением, новая — находится.
    const byNew = await ask({ text: newQuestion }).expect(201);
    expect(byNew.body.source).toBe('KNOWLEDGE');
  });

  it('архивация: DELETE переводит знание в ARCHIVED, поиск его не находит', async () => {
    const question = uniqQ('Вопрос который заархивируем');
    const created = await createKnowledge({
      question,
      answer: 'Ответ, который перестанет находиться.',
    }).expect(201);

    await request(app.getHttpServer())
      .delete(`/admin/knowledge/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: created.body.id },
    });
    // Мягкое удаление: строка жива (история нужна), статус — ARCHIVED.
    expect(row).toBeTruthy();
    expect(row?.status).toBe('ARCHIVED');

    const asked = await ask({ text: question }).expect(201);
    expect(asked.body.source).not.toBe('KNOWLEDGE');
  });

  it('POST /admin/knowledge/:id/status меняет статус, мусорный → 400', async () => {
    const created = await createKnowledge({
      question: uniqQ('Вопрос для смены статуса'),
      answer: 'Ответ.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .post(`/admin/knowledge/${created.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEW' })
      .expect(201);
    expect(res.body.status).toBe('REVIEW');

    await request(app.getHttpServer())
      .post(`/admin/knowledge/${created.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'НЕ_СТАТУС' })
      .expect(400);
  });

  // ── Предпросмотр и статистика ─────────────────────────────────────────

  it('POST /admin/knowledge/search-preview показывает ветку §5.2', async () => {
    const question = uniqQ('Можно ли вернуть товар без чека');
    const created = await createKnowledge({
      question,
      answer: 'Да, без чека тоже принимаем.',
    }).expect(201);
    knowledgeIds.push(created.body.id);

    const hit = await request(app.getHttpServer())
      .post('/admin/knowledge/search-preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ text: question })
      .expect(201);

    expect(hit.body.available).toBe(true);
    expect(hit.body.branch).toBe('KNOWLEDGE');
    expect(hit.body.hits[0].id).toBe(created.body.id);
    expect(hit.body.normalized).toBe(normalize(question));

    const miss = await request(app.getHttpServer())
      .post('/admin/knowledge/search-preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ text: 'Совершенно другой вопрос про слона и жирафа' })
      .expect(201);
    expect(miss.body.branch).toBe('LLM');
  });

  it('GET /admin/knowledge/stats отдаёт счётчики и топ фолбэков', async () => {
    const question = uniqQ('Вопрос для статистики базы');
    const created = await createKnowledge({
      question,
      answer: 'Ответ для статистики.',
    }).expect(201);
    knowledgeIds.push(created.body.id);
    await ask({ text: question }).expect(201);

    const res = await request(app.getHttpServer())
      .get('/admin/knowledge/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.active).toBeGreaterThan(0);
    expect(typeof res.body.knowledgeHitRate).toBe('number');
    expect(Array.isArray(res.body.topUsed)).toBe(true);
    expect(Array.isArray(res.body.topFalledBack)).toBe(true);

    const inTop = (res.body.topUsed as { id: string }[]).some(
      (t) => t.id === created.body.id,
    );
    expect(inTop).toBe(true);
  });

  it('GET /admin/knowledge отдаёт список с фильтром по статусу', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/knowledge?status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
    for (const item of res.body.items as { status: string }[]) {
      expect(item.status).toBe('ACTIVE');
    }
  });

  // ── Права ─────────────────────────────────────────────────────────────

  it('юзеру закрыт весь раздел базы знаний (403)', async () => {
    await request(app.getHttpServer())
      .get('/admin/knowledge')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/admin/knowledge/stats')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/admin/knowledge/candidates')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('анониму закрыт весь раздел базы знаний (401)', async () => {
    await request(app.getHttpServer()).get('/admin/knowledge').expect(401);
    await request(app.getHttpServer())
      .post('/admin/knowledge')
      .send({ question: uniqQ('Анонимный вопрос'), answer: 'Нет' })
      .expect(401);
  });

  // ── Устаревание (cron, §6.3) ──────────────────────────────────────────

  it('runMaintenance переводит неиспользуемое старое знание в STALE', async () => {
    const service = app.get(KnowledgeService);

    const question = uniqQ('Давно неиспользуемое знание');
    const created = await createKnowledge({
      question,
      answer: 'Старый ответ.',
    }).expect(201);

    // Состариваем запись: 200 дней назад, ни одного использования.
    await prisma.knowledgeEntry.update({
      where: { id: created.body.id },
      data: {
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        usageCount: 0,
        lastUsedAt: null,
      },
    });

    const res = await service.runMaintenance();
    expect(res.staled).toBeGreaterThanOrEqual(1);

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.status).toBe('STALE');
  });

  it('runMaintenance отправляет плохое знание на ревью (§6.3)', async () => {
    const service = app.get(KnowledgeService);

    const created = await createKnowledge({
      question: uniqQ('Знание с плохим рейтингом'),
      answer: 'Ответ, который всем не нравился.',
    }).expect(201);

    // 5 использований, ни одного «помогло».
    await prisma.knowledgeEntry.update({
      where: { id: created.body.id },
      data: { usageCount: 5, helpfulCount: 0, notHelpfulCount: 5 },
    });

    await service.runMaintenance();

    const row = await prisma.knowledgeEntry.findUnique({
      where: { id: created.body.id },
    });
    expect(row?.status).toBe('REVIEW');
  });
});