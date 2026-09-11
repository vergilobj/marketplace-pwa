import { createContext, useContext } from 'react';

export interface CartItem {
  productId: string;
  title: string;
  price: number;
  quantity: number;
  media?: string[];
}

/**
 * Минимум, который нужен корзине от товара. Именно поэтому здесь узкий тип,
 * а не ApiProduct: в корзину кладут и товар из ленты, и из каталога, и из
 * похожих — везде это одна и та же четвёрка полей.
 */
export interface CartProductInput {
  id: string;
  title: string;
  price: number;
  media?: string[];
}

export interface AppContextType {
  cart: CartItem[];
  addToCart: (product: CartProductInput) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  moveToFavorites: (productId: string) => void;
  clearCart: () => void;
  favorites: string[];
  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;
}

/**
 * Контекст и хук useApp — без компонентов.
 * react-refresh/only-export-components требует, чтобы файл либо экспортировал
 * компоненты, либо не-компоненты, но не то и другое сразу: иначе Fast Refresh
 * теряет состояние при правке. Поэтому сам AppProvider живёт в ./AppProvider,
 * а этот модуль остаётся точкой импорта контекста и хука (его импортируют
 * страницы и компоненты, менять их импорты не нужно).
 */
/**
 * Дефолт — null, а не пустой объект: useApp ниже падает с внятной ошибкой,
 * если компонент забыли обернуть в AppProvider. Раньше здесь стоял
 * пустой объект, приведённый к типу, и обращение к методам падало
 * невнятным TypeError.
 */
export const AppContext = createContext<AppContextType | null>(null);

export const useApp = (): AppContextType => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};