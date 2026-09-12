import api from './axios';
import type { BazarMeta, BazarRelayResult } from './types';

export interface BazarRef {
  type: string;
  id: string;
  title?: string;
  price?: number;
  media?: string[];
  description?: string;
}

export interface BazarMessage {
  id: string;
  userId: string;
  role: 'USER' | 'ASSISTANT';
  text?: string;
  refs?: BazarRef[] | null;
  meta?: BazarMeta | null;
  createdAt: string;
}

export interface BazarHistory {
  items: BazarMessage[];
  total: number;
  page: number;
  pages: number;
}

export const bazarWelcome = () =>
  api.post('/bazar/welcome').then((res) => res.data);

export const bazarSend = (text: string) =>
  api.post<BazarMessage>('/bazar/messages', { text }).then((res) => res.data);

export const bazarHistory = (page = 1, limit = 50) =>
  api
    .get<BazarHistory>('/bazar/messages', { params: { page, limit } })
    .then((res) => res.data);

export const bazarReset = () =>
  api.post<BazarHistory>('/bazar/reset').then((res) => res.data);

export interface BazarDeal {
  id: string;
  buyerId: string;
  sellerId: string;
  productId?: string | null;
  status: string;
  source: string;
  lastMsgAt?: string | null;
  msgCount: number;
  createdAt?: string;
  buyer: { id: string; name: string };
  seller: { id: string; name: string };
  product?: { id: string; title: string; price: number; media: string[] } | null;
  order?: { id: string; status: string; amount: number } | null;
}

export interface BazarDealThread {
  deal: BazarDeal;
  thread: BazarMessage[];
}

export const DEAL_STATUS_RU: Record<string, string> = {
  NEW: 'Новый лид',
  CONTACTED: 'В диалоге',
  NEGOTIATING: 'Торг',
  ACCEPTED: 'Принята',
  CLOSED: 'Закрыта',
  LOST: 'Отменена',
};

/**
 * L2: список сделок (лидов) — страницей.
 *
 * Бэкенд (`GET /bazar/deals`) принимает page/limit (потолок 100) и отдаёт
 * МАССИВ, поэтому «есть ещё» выводится из длины страницы.
 */
export const bazarDeals = (
  role: 'buyer' | 'seller' = 'buyer',
  params?: { page?: number; limit?: number },
) =>
  api
    .get<BazarDeal[]>('/bazar/deals', { params: { as: role, ...params } })
    .then((res) => res.data);

export const bazarDealThread = (dealId: string) =>
  api.get<BazarDealThread>(`/bazar/deals/${dealId}`).then((res) => res.data);

export const bazarDealRelay = (dealId: string, text: string) =>
  api.post<BazarRelayResult>(`/bazar/deals/${dealId}/relay`, { text }).then((res) => res.data);

// Алиасы под названия из спеков сделок.
export const dealThread = bazarDealThread;

export const dealAccept = (dealId: string) =>
  api.post<BazarDealThread>(`/bazar/deals/${dealId}/accept`).then((res) => res.data);

export const dealCancel = (dealId: string, reason?: string) =>
  api
    .post<BazarDealThread>(`/bazar/deals/${dealId}/cancel`, reason ? { reason } : {})
    .then((res) => res.data);