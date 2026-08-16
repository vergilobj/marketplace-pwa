import api from './axios';

export const getProducts = (params?: { page?: number; limit?: number; sort?: string }) =>
  api.get('/products', { params }).then(res => res.data);
export const createProduct = (data: { title: string; description?: string; price: number; media?: string[] }) =>
  api.post('/products', data).then(res => res.data);
export const getProductById = (id: string) => api.get(`/products/${id}`).then(res => res.data);
export const getSimilarProducts = (id: string) =>
  api.get(`/products/${id}/similar`).then(r => r.data);
