import api from './axios';
import type { ApiOrder, ApiPayment, OrderStatus } from './types';

export const getMyOrders = () =>
  api.get<ApiOrder[]>('/orders/my').then(res => res.data);

export const updateOrderStatus = (id: string, status: OrderStatus | string) =>
  api.patch<ApiOrder>(`/orders/${id}/status`, { status }).then(res => res.data);

/**
 * §4.6: createOrder отдаёт заказ вместе с платёжными реквизитами,
 * поэтому payment — часть ответа, а не отдельный тип.
 */
export const createOrder = (productId: string, amount: number) =>
  api.post<ApiOrder & { payment?: ApiPayment | null }>('/orders', { productId, amount })
    .then(res => res.data);

/** §4.3: покупатель подтверждает получение → релиз эскроу продавцу. */
export const confirmOrderReceipt = (id: string) =>
  api.post<ApiOrder>(`/orders/${id}/confirm`).then(res => res.data);

export const getOrderPaymentStatus = (orderId: string) =>
  api.get<ApiPayment>(`/payments/order/${orderId}/status`).then(res => res.data);

export const getOrderPayAddress = (orderId: string) =>
  api.get<ApiPayment>(`/payments/order/${orderId}/pay`).then(res => res.data);

export const payOrder = (orderId: string) =>
  api.post<ApiPayment>(`/payments/order/${orderId}/pay`).then(res => res.data);

export const getOrderPayStatus = (orderId: string) =>
  api.get<ApiPayment>(`/payments/order/${orderId}/status`).then(res => res.data);