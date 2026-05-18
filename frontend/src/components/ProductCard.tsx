import React from 'react';
import { Heart, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from './ui/Card';
import Button from './ui/Button';
import { useApp } from '../context/AppContext';

export default function ProductCard({ product }: { product: any }) {
  const navigate = useNavigate();
  const { addToCart, toggleFavorite, isFavorite } = useApp();

  return (
    <Card
      className="group cursor-pointer hover:shadow-xl transition-all duration-300"
      onClick={() => navigate(`/products/${product.id}`)}
    >
      <div className="relative">
        <img
          src={product.media?.[0] || '/placeholder.jpg'}
          alt={product.title}
          className="w-full h-48 object-cover rounded-xl"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(product.id);
          }}
          className="absolute top-2 right-2 p-2 bg-white/80 dark:bg-gray-900/80 rounded-full hover:bg-white dark:hover:bg-gray-800 transition"
        >
          <Heart
            size={18}
            className={
              isFavorite(product.id)
                ? 'fill-red-500 text-red-500'
                : 'text-gray-500'
            }
          />
        </button>
      </div>
      <div className="p-4 space-y-2">
        <h3 className="font-semibold text-lg truncate">{product.title}</h3>
        <p className="text-gray-500 text-sm line-clamp-2">
          {product.description}
        </p>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xl font-bold text-blue-600">
            {product.price.toLocaleString()} ₽
          </span>
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              addToCart(product);
            }}
          >
            <ShoppingCart size={16} className="mr-1" /> В корзину
          </Button>
        </div>
      </div>
    </Card>
  );
}