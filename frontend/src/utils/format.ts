export const formatPrice = (n: number) => `${n.toLocaleString('en-US', {maximumFractionDigits: 2})} USDT`;

export const formatNumber = (n: number) => n.toLocaleString('ru-RU');
