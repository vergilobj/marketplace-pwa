import api from './axios';

export const getProfile = () => api.get('/users/me').then(r => r.data);
export const updateProfile = (data: { name?: string; phone?: string }) =>
  api.patch('/users/me', data).then(r => r.data);
export const getStats = () => api.get('/users/me/stats').then(r => r.data);