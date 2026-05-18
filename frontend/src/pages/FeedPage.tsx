import React, { useEffect, useState } from 'react';
import { getFeed } from '../api/posts';
import { getProducts } from '../api/products';
import PostCard from '../components/PostCard';
import ProductCard from '../components/ProductCard';
import Spinner from '../components/ui/Spinner';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import Tabs from '../components/ui/Tabs';
import Input from '../components/ui/Input';
import { Search } from 'lucide-react';

export default function FeedPage() {
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('Все');
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      const [postsRes, productsRes] = await Promise.all([getFeed(), getProducts()]);
      setPosts(postsRes);
      setProducts(productsRes);
    } catch (e) {
      setError('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filteredPosts = posts.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()) || p.content?.toLowerCase().includes(search.toLowerCase()));
  const filteredProducts = products.filter(p => p.title.toLowerCase().includes(search.toLowerCase()));

  const renderContent = () => {
    if (activeTab === 'Посты') return filteredPosts.map(post => <PostCard key={post.id} post={post} />);
    if (activeTab === 'Товары') return <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{filteredProducts.map(product => <ProductCard key={product.id} product={product} />)}</div>;
    // Все
    return [...filteredPosts.map(p => ({ ...p, type: 'post' })), ...filteredProducts.map(p => ({ ...p, type: 'product' }))]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(item => item.type === 'post' ? <PostCard key={item.id} post={item} /> : <ProductCard key={item.id} product={item} />);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold">Лента</h1>
      <div className="relative">
        <Input
          placeholder="Поиск по ленте..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
        <Search className="absolute left-3 top-3.5 text-gray-400" size={20} />
      </div>
      <Tabs tabs={['Все', 'Товары', 'Посты']} active={activeTab} onChange={setActiveTab} />
      {loading ? <Spinner /> :
        error ? <ErrorState message={error} onRetry={fetchData} /> :
        <div className="space-y-6">
          {renderContent()}
          {((activeTab === 'Все' && filteredPosts.length === 0 && filteredProducts.length === 0) ||
            (activeTab === 'Посты' && filteredPosts.length === 0) ||
            (activeTab === 'Товары' && filteredProducts.length === 0)) && <EmptyState message="Ничего не найдено" />}
        </div>
      }
    </div>
  );
}