import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/axios';
import PostCard from '../components/PostCard';
import Breadcrumbs from '../components/Breadcrumbs';

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
      <Breadcrumbs
        items={[
          { label: 'Главная', to: '/' },
          { label: post.title },
        ]}
      />
      <PostCard post={post} />
    </div>
  );
}