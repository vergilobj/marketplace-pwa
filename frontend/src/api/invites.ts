import api from './axios';
import type { ApiInvite } from './types';

/** L2: инвайты — страницей (бэкенд клампит limit до 100, ответ — массив). */
export const getInvites = (params?: { page?: number; limit?: number }) =>
  api.get<ApiInvite[]>('/invites', { params }).then(r => r.data);

export const createInvite = (code?: string) =>
  api.post<ApiInvite>('/invites', { code }).then(r => r.data);

export const deleteInvite = (code: string) => api.delete(`/invites/${code}`);