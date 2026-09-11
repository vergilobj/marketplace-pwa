import api from './axios';
import type { ApiInvite } from './types';

export const getInvites = () =>
  api.get<ApiInvite[]>('/invites').then(r => r.data);

export const createInvite = (code?: string) =>
  api.post<ApiInvite>('/invites', { code }).then(r => r.data);

export const deleteInvite = (code: string) => api.delete(`/invites/${code}`);