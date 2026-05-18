import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShoppingBag } from 'lucide-react';
import { getProducts } from '../api/products';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProducts()
      .then(setProducts)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Товары</h1>
        <Link to="/products/new">
          <Button variant="primary">
            <Plus size={18} className="mr-2" /> Создать
          </Button>
        </Link>
      </div>
      {loading && <p className="text-center text-gray-500">Загрузка...</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((p: any) => (
          <Link to={`/products/${p.id}`} key={p.id}>
            <Card className="hover:shadow-xl transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{p.title}</h3>
                  <p className="text-gray-500 text-sm mt-1">{p.description}</p>
                  <p className="mt-3 font-bold text-blue-600">{p.price.toLocaleString()} ₽</p>
                </div>
                <ShoppingBag className="w-5 h-5 text-gray-300" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}