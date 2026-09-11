import api from './axios';

export const getProfile = () => api.get('/users/me').then(r => r.data);
export const updateProfile = (data: { name?: string; phone?: string }) =>
  api.patch('/users/me', data).then(r => r.data);
export const getStats = () => api.get('/users/me/stats').then(r => r.data);
export const becomeSeller = () =>
  api.post('/users/become-seller').then(r => r.data as { user: any; accessToken: string });

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
  api.get('/users/me/balance').then(r => r.data as BalanceResponse);

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
  api.get('/users/me/ledger', { params }).then(r => r.data as LedgerResponse);