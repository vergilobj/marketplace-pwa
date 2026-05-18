import api from './axios';

export const getPosts = () => api.get('/posts').then(res => res.data);
export const createAd = (data: { title: string; content: string; days: number }) =>
  api.post('/posts/ad', data).then(res => res.data);
export const getFeed = () => api.get('/posts/feed').then(res => res.data);