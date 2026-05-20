import React, { createContext, useContext, useState, useEffect } from 'react';
import toast from 'react-hot-toast';

interface CartItem {
  productId: string;
  title: string;
  price: number;
  quantity: number;
}

interface AppContextType {
  cart: CartItem[];
  addToCart: (product: any) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  moveToFavorites: (productId: string) => void;
  clearCart: () => void;
  favorites: string[];
  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;
}

const AppContext = createContext<AppContextType>({} as any);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('cart');
    return saved ? JSON.parse(saved) : [];
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => { localStorage.setItem('cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('favorites', JSON.stringify(favorites)); }, [favorites]);

  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        toast.success('Добавлено в корзину');
        return prev.map(item =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      toast.success('Добавлено в корзину');
      return [...prev, { productId: product.id, title: product.title, price: product.price, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
    toast.success('Удалено из корзины');
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev =>
      prev.map(item => {
        if (item.productId === productId) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) {
            return null; // будет удалено фильтрацией
          }
          return { ...item, quantity: newQty };
        }
        return item;
      }).filter(Boolean) as CartItem[]
    );
  };

  const moveToFavorites = (productId: string) => {
    const item = cart.find(i => i.productId === productId);
    if (item) {
      removeFromCart(productId);
      toggleFavorite(productId);
      toast.success('Товар отложен в избранное');
    }
  };

  const clearCart = () => setCart([]);

  const toggleFavorite = (productId: string) => {
    setFavorites(prev =>
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    );
  };

  const isFavorite = (productId: string) => favorites.includes(productId);

  return (
    <AppContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, moveToFavorites, clearCart, favorites, toggleFavorite, isFavorite }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);