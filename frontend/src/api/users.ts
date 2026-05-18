import api from './axios';

export const getProfile = () => api.get('/users/me').then(res => res.data);