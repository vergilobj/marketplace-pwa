import api from './axios';

export const getProducts = () => api.get('/products').then(res => res.data);
export const createProduct = (data: { title: string; description?: string; price: number }) =>
  api.post('/products', data).then(res => res.data);
export const getProductById = (id: string) => api.get(`/products/${id}`).then(res => res.data);
export const getSimilarProducts = (id: string) =>
  api.get(`/products/${id}/similar`).then(r => r.data);