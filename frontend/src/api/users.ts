import api from './axios';
import type { ApiUser, ApiUserStats, AuthTokens, BecomeSellerResponse, ApiSellerRequest } from './types';

export const getProfile = () =>
  api.get<ApiUser>('/users/me').then(r => r.data);

export const updateProfile = (data: { name?: string; phone?: string }) =>
  api.patch<ApiUser>('/users/me', data).then(r => r.data);

export const getStats = () =>
  api.get<ApiUserStats>('/users/me/stats').then(r => r.data);

export const becomeSeller = () =>
  api.post<BecomeSellerResponse>('/users/become-seller').then(r => r.data);

/**
 * A4: подать заявку «Стать продавцом». Роль НЕ меняется — ждёт модерации админом.
 * Бросит 400, если заявка уже на рассмотрении или юзер уже продавец.
 */
export const createSellerRequest = () =>
  api.post<ApiSellerRequest>('/users/seller-request').then(r => r.data);

/** A4: своя заявка — статус для профиля. */
export const getMySellerRequest = () =>
  api.get<ApiSellerRequest>('/users/seller-request/me').then(r => r.data);

/** §4.6: раздельные балансы. */
export type BalanceResponse = {
  availableBalance: number;
  bonusBalance: number;
  pendingEscrow: number;
  totalWithdrawable: number;
  /** @deprecated обратная совместимость */
  balance?: number;
};

export const getBalance = () =>
  api.get<BalanceResponse>('/users/me/balance').then(r => r.data);

export type LedgerEntryItem = {
  id: string;
  account: 'ESCROW' | 'AVAILABLE' | 'REFERRAL' | 'PLATFORM';
  amount: number;
  currency: string;
  type: string;
  orderId?: string | null;
  balanceAfter?: number | null;
  createdAt: string;
};

export type LedgerResponse = {
  items: LedgerEntryItem[];
  nextCursor: string | null;
};

export const getLedger = (params?: { limit?: number; cursor?: string }) =>
  api.get<LedgerResponse>('/users/me/ledger', { params }).then(r => r.data);

export type { AuthTokens };