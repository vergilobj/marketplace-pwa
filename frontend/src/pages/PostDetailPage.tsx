import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Heart, MessageCircle, Share2, MoreHorizontal, Copy, Flag, Pencil, Trash2, X, Play, Link as LinkIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactPlayer from 'react-player';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Skeleton from '../components/ui/Skeleton';
import { likePost, unlikePost, getComments, addComment } from '../api/social';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const userId = localStorage.getItem('userId');
  const isAuthor = userId && post && userId === post.author?.id;

  useEffect(() => {
    if (id) {
      api.get(`/posts/${id}`).then(res => {
        const p = res.data;
        setPost(p);
        setLikes(p.likeCount || 0);
        setLiked(p.likedByMe || false);
        return getComments(p.id);
      }).then(commentsData => {
        setComments(commentsData);
      }).finally(() => setLoading(false));
    }
  }, [id]);

  const handleLike = async () => {
    if (liked) {
      await unlikePost(post.id);
      setLikes(l => l - 1);
    } else {
      await likePost(post.id);
      setLikes(l => l + 1);
    }
    setLiked(!liked);
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const comment = await addComment(post.id, newComment);
    setComments([...comments, comment]);
    setNewComment('');
  };

  const handleShare = () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Ссылка скопирована'));
    setMenuOpen(false);
  };

  const handleReport = () => {
    toast.success('Жалоба отправлена');
    setMenuOpen(false);
  };

  const handleDelete = async () => {
    if (!confirm('Удалить пост?')) return;
    await api.delete(`/posts/${post.id}`);
    toast.success('Пост удалён');
    navigate('/');
  };

  const truncateUrl = (url: string) => {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname;
    } catch {
      return url.length > 40 ? url.slice(0, 40) + '...' : url;
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  if (!post) return <p className="text-center py-10 text-red-500">Пост не найден</p>;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      <Link to="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} className="mr-1" /> Назад к ленте
      </Link>

      <Card className="space-y-6">
        {/* Заголовок и мета */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{post.title || 'Без названия'}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                {post.author?.name?.[0] || 'A'}
              </div>
              <span className="font-medium text-gray-700 dark:text-gray-300">{post.author?.name}</span>
            </div>
            <span>·</span>
            <span>{format(new Date(post.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}</span>
          </div>
        </div>

        {/* Контент */}
        {post.content && <p className="text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">{post.content}</p>}

        {/* Ссылка */}
        {post.link && (
          <a
            href={post.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
          >
            <LinkIcon size={18} className="flex-shrink-0" />
            <span className="text-sm truncate">{truncateUrl(post.link)}</span>
            <span className="ml-auto text-xs opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
          </a>
        )}

        {/* Медиа */}
        {post.media && post.media.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {post.media.map((url: string, idx: number) => (
              <img
                key={idx}
                src={url}
                alt={`${post.title} ${idx + 1}`}
                className="rounded-2xl cursor-pointer hover:opacity-90 transition object-cover h-64 w-full"
                onClick={() => setSelectedImage(url)}
              />
            ))}
          </div>
        )}

        {/* Видео */}
        {post.videoUrl && (
          <div className="rounded-2xl overflow-hidden">
            <ReactPlayer url={post.videoUrl} width="100%" height="400px" controls light={post.media?.[0] || true} playIcon={<div className="absolute inset-0 flex items-center justify-center"><Play size={48} className="text-white bg-black/30 rounded-full p-2" /></div>} />
          </div>
        )}

        {/* Действия */}
        <div className="flex items-center gap-6 text-gray-500 border-t pt-4">
          <motion.button whileTap={{ scale: 0.8 }} onClick={handleLike} className={`flex items-center gap-1 ${liked ? 'text-red-500' : ''}`}>
            <Heart size={20} fill={liked ? 'currentColor' : 'none'} /> {likes}
          </motion.button>
          <motion.button whileTap={{ scale: 0.8 }} className="flex items-center gap-1">
            <MessageCircle size={20} /> {comments.length}
          </motion.button>
          <motion.button whileTap={{ scale: 0.8 }} onClick={handleShare} className="flex items-center gap-1">
            <Share2 size={20} />
          </motion.button>
          <div className="relative ml-auto">
            <button onClick={() => setMenuOpen(!menuOpen)} className="p-1">
              <MoreHorizontal size={20} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
                >
                  <button onClick={handleShare} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full"><Copy size={14} /> Скопировать ссылку</button>
                  <button onClick={handleReport} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full"><Flag size={14} /> Пожаловаться</button>
                  {isAuthor && (
                    <>
                      <button onClick={() => navigate(`/posts/${post.id}/edit`)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full"><Pencil size={14} /> Редактировать</button>
                      <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 w-full"><Trash2 size={14} /> Удалить</button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Комментарии */}
        <div className="border-t pt-4 space-y-4">
          <h3 className="font-semibold text-lg">Комментарии ({comments.length})</h3>
          <AnimatePresence>
            {comments.map(c => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold">{c.user?.name?.[0] || '?'}</div>
                <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-2xl flex-1">
                  <p className="text-sm font-semibold">{c.user?.name}</p>
                  <p className="text-sm">{c.text}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <form onSubmit={submitComment} className="flex gap-2 mt-4">
            <Input placeholder="Напишите комментарий..." value={newComment} onChange={e => setNewComment(e.target.value)} className="flex-1" />
            <Button type="submit" variant="primary" size="sm">Отправить</Button>
          </form>
        </div>
      </Card>

      {/* Модальное окно изображения */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setSelectedImage(null)}
          >
            <button className="absolute top-4 right-4 text-white" onClick={() => setSelectedImage(null)}><X size={32} /></button>
            <motion.img initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} src={selectedImage} className="max-w-full max-h-full rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}