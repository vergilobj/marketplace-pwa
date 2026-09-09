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
      !q || q.length <= 3 || words.length === 0 || words.every((w) => w.length < 3);
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

    const [products, posts, users, orders] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          isActive: true,
          ...(budget != null ? { price: { lte: budget } } : {}),
          OR: this.termConditions(['title', 'description'], words),
        },
        include: { seller: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
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
    return tokens.filter(
      (w) => !STOP_WORDS.has(w) && !/^\d+(?:к|k|тыс|тысяч)?$/.test(w),
    );
  }

  /** Достаёт бюджет из «до N рублей», «до 10к», «до 10000» (возвращает null если нет). */
  private extractBudget(q: string): number | null {
    const m = q.toLowerCase().match(
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
      where: { isActive: true, ...(budget != null ? { price: { lte: budget } } : {}) },
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