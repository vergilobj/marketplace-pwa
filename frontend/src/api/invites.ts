import api from './axios';

export const getInvites = () => api.get('/invites').then(r => r.data);
export const createInvite = () => api.post('/invites').then(r => r.data);
export const deleteInvite = (code: string) => api.delete(`/invites/${code}`);