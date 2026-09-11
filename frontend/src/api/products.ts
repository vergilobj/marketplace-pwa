import api from './axios';
import type { ApiPaginated, ApiProduct } from './types';

export type ProductQuery = {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
};

export const getProducts = (params?: ProductQuery) =>
  api.get<ApiPaginated<ApiProduct>>('/products', { params }).then(res => res.data);

export const createProduct = (data: {
  title: string;
  description?: string;
  price: number;
  media?: string[];
  videoUrl?: string;
}) => api.post<ApiProduct>('/products', data).then(res => res.data);

export const getProductById = (id: string) =>
  api.get<ApiProduct>(`/products/${id}`).then(res => res.data);

export const getSimilarProducts = (id: string) =>
  api.get<ApiProduct[]>(`/products/${id}/similar`).then(r => r.data);