import api from './axios';

export const getPosts = (params?: { page?: number; limit?: number; sort?: string }) =>
  api.get('/posts', { params }).then(r => r.data);
export const getFeed = (params?: { page?: number; limit?: number; sort?: string }) =>
  api.get('/posts/feed', { params }).then(r => r.data);
export const createPost = (data: { title: string; content?: string; link?: string; media?: string[]; videoUrl?: string }) =>
  api.post('/posts', data).then(r => r.data);
export const createAd = (data: { title: string; content: string; days: number }) =>
  api.post('/posts/ad', data).then(r => r.data);
