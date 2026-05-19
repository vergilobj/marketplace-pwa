import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api/axios';
import PostCard from '../components/PostCard';

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      api.get(`/posts/${id}`)
        .then(res => setPost(res.data))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) return <p className="text-center py-10 text-gray-500">Загрузка...</p>;
  if (!post) return <p className="text-center py-10 text-red-500">Пост не найден</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} className="mr-1" /> Назад к ленте
      </Link>
      <PostCard post={post} />
    </div>
  );
}