import api from './axios';

export const getMyOrders = () => api.get('/orders/my').then(res => res.data);
export const updateOrderStatus = (id: string, status: string) =>
  api.patch(`/orders/${id}/status`, { status }).then(res => res.data);
export const createOrder = (productId: string, amount: number) =>
    api.post('/orders', { productId, amount }).then(res => res.data);

/** §4.3: покупатель подтверждает получение → релиз эскроу продавцу. */
export const confirmOrderReceipt = (id: string) =>
    api.post(`/orders/${id}/confirm`).then(res => res.data);

export const getOrderPaymentStatus = (orderId: string) =>
    api.get(`/payments/order/${orderId}/status`).then(res => res.data);
export const getOrderPayAddress = (orderId: string) =>
    api.get(`/payments/order/${orderId}/pay`).then(res => res.data);
export const payOrder = (orderId: string) =>
    api.post(`/payments/order/${orderId}/pay`).then(res => res.data);
export const getOrderPayStatus = (orderId: string) =>
    api.get(`/payments/order/${orderId}/status`).then(res => res.data);