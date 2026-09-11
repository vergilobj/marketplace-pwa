import api from './axios';

export const getPosts = (params?: { page?: number; limit?: number; sort?: string; search?: string }) =>
  api.get('/posts', { params }).then(r => r.data);
export const getFeed = (params?: { page?: number; limit?: number; sort?: string; search?: string }) =>
  api.get('/posts/feed', { params }).then(r => r.data);
export const createPost = (data: { title: string; content?: string; link?: string; media?: string[]; videoUrl?: string }) =>
  api.post('/posts', data).then(r => r.data);

/**
 * S1 (NH5-ad): рекламный заказ. Бэкенд возвращает созданный пост вместе с
 * relation `order` (заказ в PENDING, escrow NONE) — реклама НЕ активна, пока
 * не подтверждён депозит. orderId нужен фронту, чтобы показать экран оплаты.
 */
export type AdOrder = {
  id: string;
  amount: number;
  status: string;
  escrowStatus?: string;
};

export type AdPostResponse = {
  id: string;
  title: string;
  content?: string | null;
  orderId?: string | null;
  order?: AdOrder | null;
};

export const createAd = (data: { title: string; content: string; link?: string; days: number }) =>
  api.post<AdPostResponse>('/posts/ad', data).then(r => r.data);