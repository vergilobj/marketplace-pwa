/**
 * Кэш ленты (R10): мгновенное восстановление списка при возврате с карточки.
 *
 * Вынесен из FeedPage по двум причинам:
 *  - страница должна экспортировать только компонент (react-refresh/only-export-components);
 *  - чтение sessionStorage происходит в ленивом инициализаторе useState, а не в
 *    setState внутри эффекта (react-hooks/set-state-in-effect).
 */

import type { ApiPost, ApiProduct } from '../api/types';

export type FeedCache = {
  posts: ApiPost[];
  products: ApiProduct[];
  totalPosts: number;
  totalProducts: number;
  postsPage: number;
  productsPage: number;
  hasMorePosts: boolean;
  hasMoreProducts: boolean;
};

const KEY = 'feed_cache';

/** Читает кэш ленты. Пустая или битая запись → null (грузим с сервера). */
export function readFeedCache(): FeedCache | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.posts?.length && !parsed?.products?.length) return null;
    return {
      posts: parsed.posts ?? [],
      products: parsed.products ?? [],
      totalPosts: parsed.totalPosts ?? parsed.posts?.length ?? 0,
      totalProducts: parsed.totalProducts ?? parsed.products?.length ?? 0,
      postsPage: parsed.postsPage ?? 2,
      productsPage: parsed.productsPage ?? 2,
      hasMorePosts: parsed.hasMorePosts ?? true,
      hasMoreProducts: parsed.hasMoreProducts ?? true,
    };
  } catch {
    // Повреждённая запись в sessionStorage — не повод падать, просто грузим с сервера.
    return null;
  }
}

/** Сохраняет состояние ленты перед уходом на карточку. */
export function writeFeedCache(data: FeedCache): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Приватный режим / переполнение storage — кэш не критичен для работы ленты.
  }
}