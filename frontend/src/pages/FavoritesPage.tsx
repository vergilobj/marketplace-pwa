import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getProducts } from '../api/products';
import ProductCard from '../components/ProductCard';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';

export default function FavoritesPage() {
  const { favorites } = useApp();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProducts().then(data => {
      setProducts(data.filter((p: any) => favorites.includes(p.id)));
    }).finally(() => setLoading(false));
  }, [favorites]);

  if (loading) return <Spinner />;
  if (products.length === 0) return <EmptyState message="В избранном пусто" />;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Избранное</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {products.map(product => <ProductCard key={product.id} product={product} />)}
      </div>
    </div>
  );
}