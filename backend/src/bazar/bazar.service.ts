import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BazarApiClient } from './bazar.api-client';
import { CatalogSearchService } from './catalog-search.service';
import { IntentDispatcher, type IntentAction } from './intent-dispatcher.service';
import { AutopilotService } from './autopilot.service';

@Injectable()
export class BazarService {
  private readonly logger = new Logger(BazarService.name);

  constructor(
    private prisma: PrismaService,
    private apiClient: BazarApiClient,
    private search: CatalogSearchService,
    private intentDispatcher: IntentDispatcher,
    private autopilot: AutopilotService,
  ) {}

  /** Идемпотентное приветствие нового юзера. Личность — из SOUL профиля bazar. */
  async ensureWelcome(userId: string): Promise<{ created: boolean; message?: any }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.bazarWelcomed) return { created: false };

    const sessionKey = user.bazarSessionKey || userId;

    const userMessage = `Поприветствуй нового пользователя ${user.name ?? 'друг'}. Расскажи что ты поможешь найти товары/услуги на площадке.`;

    let text: string;
    let refs: any[] = [];
    try {
      const welcome = await this.apiClient.complete(
        [{ role: 'user', content: userMessage }],
        { sessionKey },
      );
      text = welcome.text;
      refs = welcome.refs ?? [];
    } catch (e) {
      // API лёг — отдаём статичное приветствие, не блочим вход юзеру.
      this.logger.warn(`Welcome fallback for ${userId}: ${(e as Error).message}`);
      text = `Привет, ${user.name ?? 'друг'}! Я Базар — помогу найти товары, услуги и людей на площадке. Спроси, что ищешь.`;
    }

    const msg = await this.prisma.bazarMessage.create({
      data: {
        userId,
        role: 'ASSISTANT',
        text,
        refs,
        meta: { intent: 'welcome' },
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { bazarWelcomed: true },
    });
    return { created: true, message: msg };
  }

  /** Основной send: сохранить реплику → поиск → контекст → API → сохранить ответ. */
  async send(userId: string, text: string) {
    await this.prisma.bazarMessage.create({
      data: { userId, role: 'USER', text, refs: [], meta: {} },
    });

    // Если у юзера активен автоподбор — маршрутизируем в автопилот,
    // минуя обычный LLM-поток (иначе агент переищет и потеряет кандидатов).
    const activeRun = await this.prisma.autopilotRun.findFirst({
      where: { userId, kind: 'AUTOPILOT', status: { in: ['RUNNING', 'AWAITING_USER'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (activeRun) {
      const isConfirm = this.isConfirmText(text);
      try {
        return await this.autopilot.resume(userId, {
          type: isConfirm ? 'confirm' : 'refine',
          accept: isConfirm ? true : false,
          text,
          feedback: isConfirm ? undefined : text,
        });
      } catch (e) {
        this.logger.warn(`Autopilot resume failed for ${userId}: ${(e as Error).message}`);
        // Упал автопилот — не роняем чат, отдаём обычный ответ ниже.
      }
    }

    const catalog = await this.search.search(text, userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, bonusBalance: true, bazarSessionKey: true },
    });

    const history = await this.prisma.bazarMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { role: true, text: true },
    });

    // Сделки юзера (как покупатель и как продавец), чтобы агент видел реальные dealId.
    const [dealsAsBuyer, dealsAsSeller] = await Promise.all([
      this.prisma.deal.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          product: { select: { id: true, title: true, price: true } },
          seller: { select: { id: true, name: true } },
        },
      }),
      this.prisma.deal.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          product: { select: { id: true, title: true, price: true } },
          buyer: { select: { id: true, name: true } },
        },
      }),
    ]);

    const compactDeal = (
      d: typeof dealsAsBuyer[number] | typeof dealsAsSeller[number],
      counterparty: { id: string; name: string | null } | undefined,
    ) => ({
      id: d.id,
      status: d.status,
      product: d.product,
      counterparty,
      createdAt: d.createdAt,
    });

    const deals = {
      asBuyer: dealsAsBuyer.map((d) => compactDeal(d, d.seller)),
      asSeller: dealsAsSeller.map((d) => compactDeal(d, d.buyer)),
    };

    const dealsHint =
      'Твои сделки: asBuyer — где ты покупатель, asSeller — где ты продавец. ' +
      'Используй id из них как dealId для relay_message/accept_deal/cancel_deal/counter_offer. ' +
      'НЕ говори «сделок нет», если они есть в списке.';

    const contextBlock = JSON.stringify({
      user,
      catalog,
      history: history.reverse(),
      deals,
      dealsHint,
    });

    // Явная инструкция: каталог содержит И товары, И посты ленты.
    const catalogHint =
      'В каталоге (catalog) есть и товары (PRODUCT в catalog.products), и посты ленты (POST в catalog.posts). ' +
      'Отвечая на поиск, показывай И товары, И посты: для постов используй refs типом "POST", для товаров — "PRODUCT". ' +
      'Не игнорируй посты, даже если пользователь просил «товары» — упоминай релевантные посты ленты тоже.';

    // Без system-роли: личность подхватит SOUL профиля bazar.
    const userMessage = `КОНТЕКСТ:\n${contextBlock}\n\n${catalogHint}\n\nЗАПРОС ПОЛЬЗОВАТЕЛЯ: ${text}`;

    let answer;
    try {
      answer = await this.apiClient.complete(
        [{ role: 'user', content: userMessage }],
        { sessionKey: user?.bazarSessionKey || userId },
      );
    } catch (e) {
      this.logger.warn(`send bazar failed for ${userId}: ${(e as Error).message}`);
      throw e;
    }

    // Запрос на автоподбор: НЕ пишем свой текст и НЕ диспатчим отдельно —
    // автопилот сам делает search + LLM + сохраняет ОДНО assistant-сообщение.
    // Иначе получится двойная генерация списков (наша + из AutopilotService.start).
    if (answer.action?.intent === 'autopilot_request' && answer.action.payload?.goal) {
      try {
        return await this.autopilot.start(
          userId,
          answer.action.payload.goal,
          answer.action.payload.budget,
        );
      } catch (e) {
        this.logger.warn(`Autopilot start failed for ${userId}: ${(e as Error).message}`);
        // Fallback: не оставляем наполовину записанный текст, отдаём адекватную реплику.
        return this.prisma.bazarMessage.create({
          data: {
            userId,
            role: 'ASSISTANT',
            text: 'Помощник подбора временно недоступен или уже идёт подбор. Попробуйте чуть позже.',
            refs: [],
            meta: { action: null, model: 'bazar' },
          },
        });
      }
    }

    const msg = await this.prisma.bazarMessage.create({
      data: {
        userId,
        role: 'ASSISTANT',
        text: answer.text,
        refs: answer.refs ?? [],
        meta: {
          action: answer.action ?? null,
          model: 'bazar',
        },
      },
    });

    // Исполняем структурированное действие (SPEC §12.3).
    if (answer.action?.intent && answer.action.intent !== 'none') {
      try {
        await this.intentDispatcher.dispatch(
          userId,
          answer.action as IntentAction,
          msg,
        );
      } catch (e) {
        // Действие не должно ронять основной ответ чата.
        this.logger.warn(
          `Intent dispatch failed for ${userId} (${answer.action.intent}): ${(e as Error).message}`,
        );
      }
    }

    return msg;
  }

  /** Полный сброс диалога: чистим историю, генерим новый session key, шлём новое приветствие. */
  async reset(userId: string) {
    await this.prisma.bazarMessage.deleteMany({ where: { userId } });
    // Закрываем зависший автоподбор, чтобы новый запрос начал свежий run, а не refine старого.
    await this.prisma.autopilotRun.updateMany({
      where: { userId, kind: 'AUTOPILOT', status: { in: ['RUNNING', 'AWAITING_USER'] } },
      data: { status: 'CANCELLED', lastStepAt: new Date() },
    });
    const newSessionKey = `${userId}_${Date.now()}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { bazarWelcomed: false, bazarSessionKey: newSessionKey },
    });
    await this.ensureWelcome(userId);
    return this.history(userId);
  }

  async history(userId: string, page = 1, limit = 50) {
    const [items, total] = await Promise.all([
      this.prisma.bazarMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bazarMessage.count({ where: { userId } }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  /** Фича 3: записать ViewEvent (открытие карточки товара). */
  async recordView(userId: string, productId: string) {
    await this.prisma.viewEvent.create({
      data: { userId, productId },
    });
    return { ok: true };
  }

  /** Фича 4: прочитать trustScore продавца. */
  async getTrustScore(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, trustScore: true, trustScoreAt: true },
    });
    if (!user) throw new Error('Пользователь не найден');
    return user;
  }

  /** Фича 6: сгенерировать продающее описание + теги + цену из аналогов. */
  async generateDescription(rawText: string) {
    const firstWord = (rawText || '').trim().split(/\s+/)[0] || '';
    const analogs = await this.prisma.product.findMany({
      where: {
        isActive: true,
        title: { contains: firstWord, mode: 'insensitive' },
      },
      take: 5,
      select: { title: true, price: true, description: true },
    });

    const prompt = `Сгенерируй для товара "${rawText}" продающее описание, теги и цену из аналогов. Строго JSON:
{"title":"...","description":"...","tags":["..."],"price":123}

Аналоги: ${JSON.stringify(analogs)}`;

    const res = await this.apiClient.complete(
      [{ role: 'user', content: prompt }],
      { temperature: 0.6 },
    );

    return this.parseJsonBlock(res.text);
  }

  /** Эвристика: похоже ли сообщение на подтверждение выбора в автоподборе. */
  private isConfirmText(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    // Явное согласие / выбор
    if (/(?:^|[^а-яё])да(?:[^а-яё]|$)/.test(t)) return true;
    if (/(?:беру|возьму|согласен|согласна|ок|окей|го|давай|этот|эту|это|его|её|первый|второй|третий)/.test(t)) {
      return true;
    }
    return false;
  }

  private parseJsonBlock(text: string): any {
    // Извлекаем первый JSON-объект из текста (в фенсах или без).
    const fenced = text.match(/```(?:json)?\n([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    try {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      return JSON.parse(candidate);
    } catch {
      return { raw: text };
    }
  }
}