import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const STOP_WORDS = new Set([
  'что',
  'есть',
  'покажи',
  'найди',
  'продают',
  'купить',
  'хочу',
  'где',
  'какой',
  'какие',
  'весь',
  'всё',
  'все',
  'любой',
  'что-нибудь',
  'что-то',
  'подбери',
  'посоветуй',
  'а',
  'и',
  'на',
  'в',
  'у',
  'с',
  'по',
  'для',
  'мне',
  'надо',
  'нужен',
  'нужна',
  'нужно',
  'товар',
  'товары',
  'вещь',
  'штука',
  'штуки',
]);

@Injectable()
export class CatalogSearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string, userId: string) {
    const q = (query || '').trim();
    const words = this.meaningfulWords(q);
    const budget = this.extractBudget(q);
    const isShortOrGeneric =
      !q ||
      q.length <= 3 ||
      words.length === 0 ||
      words.every((w) => w.length < 3);
    const hasTerms = words.length > 0;

    const usersPromise = hasTerms
      ? this.prisma.user.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          select: { id: true, name: true, role: true },
          take: 3,
        })
      : Promise.resolve([]);

    const ordersPromise = this.prisma.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: { product: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    if (isShortOrGeneric) {
      const [products, posts, users, orders] = await Promise.all([
        this.freshProducts(budget),
        this.freshPosts(),
        usersPromise,
        ordersPromise,
      ]);
      return {
        products,
        posts,
        users,
        orders,
        meta: { reason: 'short_query', budget },
      };
    }

    const includeSeller = { seller: { select: { id: true, name: true } } };
    const baseProductWhere = {
      isActive: true,
      ...(budget != null ? { price: { lte: budget } } : {}),
    };

    // Селективность слов по title: редкое «248» важнее общего «beautybox».
    // Считаем частоту каждого слова в title и отбрасываем те, которых нет
    // ни в одном title (шум вроде «оформи»). Кандидаты собираются по каждому
    // оставшемуся слову отдельно, затем сортируются по числу совпадений.
    const titleCounts = await Promise.all(
      words.map(async (w) => ({
        word: w,
        count: await this.prisma.product.count({
          where: {
            isActive: true,
            title: { contains: w, mode: 'insensitive' },
          },
        }),
      })),
    );
    const rankedWords = titleCounts
      .filter((t) => t.count > 0)
      .sort((a, b) => a.count - b.count)
      .map((t) => t.word);

    const [rankedProducts, partialProducts, posts, users, orders] =
      await Promise.all([
        this.findRankedProducts(rankedWords, baseProductWhere, includeSeller),
        this.prisma.product.findMany({
          where: {
            ...baseProductWhere,
            OR: this.termConditions(['title', 'description'], words),
          },
          include: includeSeller,
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        this.prisma.post.findMany({
          where: {
            isHidden: false,
            OR: this.termConditions(['title', 'content'], words),
          },
          include: { author: { select: { id: true, name: true } } },
          take: 4,
        }),
        usersPromise,
        ordersPromise,
      ]);

    const rankedIds = new Set(rankedProducts.map((p) => p.id));
    const scoredPartial = partialProducts
      .filter((p) => !rankedIds.has(p.id))
      .map((p) => ({ product: p, score: this.matchScore(p, words) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          new Date(b.product.createdAt).getTime() -
            new Date(a.product.createdAt).getTime(),
      )
      .map((x) => x.product);

    const products = [...rankedProducts, ...scoredPartial].slice(0, 6);

    if (products.length === 0 && posts.length === 0) {
      const [fallbackProducts, fallbackPosts] = await Promise.all([
        this.freshProducts(budget),
        this.freshPosts(),
      ]);
      return {
        products: fallbackProducts,
        posts: fallbackPosts,
        users,
        orders,
        meta: { reason: 'fallback_no_match', budget },
      };
    }

    return { products, posts, users, orders };
  }

  private meaningfulWords(q: string): string[] {
    const tokens = q
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter(Boolean);
    return tokens.filter((w) => !STOP_WORDS.has(w));
  }

  /** Достаёт бюджет из «до N рублей», «до 10к», «до 10000» (возвращает null если нет). */
  private extractBudget(q: string): number | null {
    const m = q
      .toLowerCase()
      .match(
        /(?:до|максимум|не дороже|до)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:к|k|тыс|тысяч|руб|р\.?|₽)?/i,
      );
    if (!m) return null;
    const raw = parseFloat(m[1]);
    if (isNaN(raw) || raw <= 0) return null;
    const suffix = q
      .toLowerCase()
      .slice(m.index ?? 0, (m.index ?? 0) + 20)
      .match(/к|k|тыс|тысяч/i);
    return suffix ? raw * 1000 : raw;
  }

  /**
   * Точная выдача по title: товары, где встречается хотя бы одно значимое
   * слово, сортируются в памяти по числу совпавших слов (больше = выше),
   * затем по свежести. «248» + «beautybox» + «планшет» выводит нужный
   * товар наверх, не теряя его из-за take.
   */
  private async findRankedProducts(
    rankedWords: string[],
    baseWhere: Record<string, unknown>,
    include: Record<string, unknown>,
  ) {
    if (rankedWords.length === 0) return [];
    // По одному запросу на слово: редкое «248»/«lpj» имеет мало совпадений,
    // поэтому гарантированно попадает в кандидаты (в отличие от общего OR
    // с take, где редкий товар мог не попасть в срез).
    const perWord = await Promise.all(
      rankedWords.map((w) =>
        this.prisma.product.findMany({
          where: { ...baseWhere, title: { contains: w, mode: 'insensitive' } },
          include,
          orderBy: { createdAt: 'desc' },
          take: 60,
        }),
      ),
    );
    const byId = new Map<
      string,
      { id: string; title: string; createdAt: Date }
    >();
    for (const list of perWord) {
      for (const p of list) if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()]
      .map((p) => ({ product: p, score: this.matchScore(p, rankedWords) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          new Date(b.product.createdAt).getTime() -
            new Date(a.product.createdAt).getTime(),
      )
      .map((x) => x.product)
      .slice(0, 6);
  }

  /** Число значимых слов в title (title весит x2 против description). */
  private matchScore(
    product: { title: string; description?: string | null },
    words: string[],
  ): number {
    const title = (product.title || '').toLowerCase();
    const desc = (product.description || '').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 2;
      else if (desc.includes(w)) score += 1;
    }
    return score;
  }

  private termConditions(
    fields: string[],
    words: string[],
  ): Array<Record<string, unknown>> {
    const conditions: Array<Record<string, unknown>> = [];
    for (const field of fields) {
      for (const word of words) {
        conditions.push({ [field]: { contains: word, mode: 'insensitive' } });
      }
    }
    return conditions;
  }

  private freshProducts(budget?: number | null) {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(budget != null ? { price: { lte: budget } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
      take: 6,
    });
  }

  private freshPosts() {
    return this.prisma.post.findMany({
      where: { isHidden: false },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
      take: 4,
    });
  }
}
