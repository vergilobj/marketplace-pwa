import api from './axios';

export const getPosts = () => api.get('/posts').then(r => r.data);
export const getFeed = () => api.get('/posts/feed').then(r => r.data);
export const createPost = (data: { title: string; content?: string; link?: string; media?: string[]; videoUrl?: string }) =>
  api.post('/posts', data).then(r => r.data);
export const createAd = (data: { title: string; content: string; days: number }) =>
  api.post('/posts/ad', data).then(r => r.data);