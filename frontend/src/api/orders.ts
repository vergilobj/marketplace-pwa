import api from './axios';

export const getMyOrders = () => api.get('/orders/my').then(res => res.data);
export const updateOrderStatus = (id: string, status: string) =>
  api.patch(`/orders/${id}/status`, { status }).then(res => res.data);
export const createOrder = (productId: string, amount: number) =>
    api.post('/orders', { productId, amount }).then(res => res.data);