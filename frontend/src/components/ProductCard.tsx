import React from 'react';
import { Heart, ShoppingCart, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Card from './ui/Card';
import Button from './ui/Button';
import { useApp } from '../context/AppContext';

export default function ProductCard({ product }: { product: any }) {
  const navigate = useNavigate();
  const { addToCart, toggleFavorite, isFavorite } = useApp();

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <Card
        className="group cursor-pointer hover:shadow-xl transition-shadow duration-300 overflow-hidden"
        onClick={() => navigate(`/products/${product.id}`)}
      >
        <div className="relative overflow-hidden rounded-xl">
          <motion.img
            src={product.media?.[0] || '/placeholder.jpg'}
            alt={product.title}
            className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(product.id);
            }}
            className="absolute top-3 right-3 p-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-full hover:bg-white dark:hover:bg-gray-800 transition shadow-lg"
          >
            <Heart
              size={18}
              className={isFavorite(product.id) ? 'fill-red-500 text-red-500' : 'text-gray-600'}
            />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/products/${product.id}?quickview=1`);
            }}
            className="absolute top-3 left-3 p-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          >
            <Eye size={18} className="text-gray-600" />
          </motion.button>
        </div>
        <div className="p-4 space-y-2">
          <h3 className="font-semibold text-lg truncate">{product.title}</h3>
          <p className="text-gray-500 text-sm line-clamp-2">{product.description}</p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xl font-bold text-blue-600">{product.price.toLocaleString()} ₽</span>
            <motion.div whileTap={{ scale: 0.95 }}>
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
            </motion.div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}