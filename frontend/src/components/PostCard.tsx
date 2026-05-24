import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Heart, MessageCircle, Share2, MoreHorizontal, X, Play,
  Copy, Flag, Pencil, Trash2, Link as LinkIcon, Video
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactPlayer from 'react-player';
import Card from './ui/Card';
import Input from './ui/Input';
import { likePost, unlikePost, getComments, addComment } from '../api/social';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

export default function PostCard({ post, onDelete, onEdit }: any) {
  const navigate = useNavigate();
  const [likes, setLikes] = useState(post.likeCount || 0);
  const [liked, setLiked] = useState(post.likedByMe || false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const userId = localStorage.getItem('userId');
  const isAuthor = userId && userId === post.author?.id;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const loadComments = async () => {
    const data = await getComments(post.id);
    setComments(data);
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const comment = await addComment(post.id, newComment);
    setComments([...comments, comment]);
    setNewComment('');
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/posts/${post.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Ссылка скопирована'));
    setMenuOpen(false);
  };

  const handleReport = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.success('Жалоба отправлена');
    setMenuOpen(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) onEdit(post);
    setMenuOpen(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) onDelete(post.id);
    setMenuOpen(false);
  };

  const truncateUrl = (url: string) => {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname;
    } catch {
      return url.length > 40 ? url.slice(0, 40) + '...' : url;
    }
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <Card
        className="cursor-pointer hover:shadow-lg transition-shadow"
        onClick={() => navigate(`/posts/${post.id}`)}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
                {post.author?.name?.[0] || 'A'}
              </div>
              <div>
                <h4 className="font-semibold">{post.author?.name}</h4>
                <p className="text-xs text-gray-500">
                  {format(new Date(post.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}
                </p>
              </div>
            </div>
            <div className="relative" ref={menuRef}>
              <button
                className="p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(!menuOpen);
                }}
              >
                <MoreHorizontal size={18} className="text-gray-400" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={handleShare} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full">
                      <Copy size={14} /> Скопировать ссылку
                    </button>
                    <button onClick={handleReport} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full">
                      <Flag size={14} /> Пожаловаться
                    </button>
                    {isAuthor && (
                      <>
                        <button onClick={handleEdit} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 w-full">
                          <Pencil size={14} /> Редактировать
                        </button>
                        <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 w-full">
                          <Trash2 size={14} /> Удалить
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Заголовок (если есть) */}
          {post.title && <h3 className="text-xl font-semibold">{post.title}</h3>}

          {/* Текст */}
          {post.content && <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">{post.content}</p>}

          {/* Ссылка */}
          {post.link && (
            <a
              href={post.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
            >
              <LinkIcon size={18} className="flex-shrink-0" />
              <span className="text-sm truncate">{truncateUrl(post.link)}</span>
              <span className="ml-auto text-xs opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
            </a>
          )}

          {/* Медиа */}
          {post.media && post.media.length > 0 && (
            <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
              {post.media.map((url: string, idx: number) => (
                <img key={idx} src={url} className="rounded-xl cursor-pointer hover:opacity-90 object-cover h-48 w-full" onClick={(e) => { e.stopPropagation(); setSelectedImage(url); }} />
              ))}
            </div>
          )}

          {/* Видео */}
          {post.videoUrl && (
            <div className="rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <ReactPlayer url={post.videoUrl} width="100%" height="300px" controls light={post.media?.[0] || true} playIcon={<div className="absolute inset-0 flex items-center justify-center"><Play size={48} className="text-white bg-black/30 rounded-full p-2" /></div>} />
            </div>
          )}

          {/* Индикатор видео (если есть URL, но медиа ещё не загружено) */}
          {post.videoUrl && !post.media && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Video size={16} /> Видео в посте
            </div>
          )}

          {/* Действия */}
          <div className="flex items-center gap-6 text-gray-500" onClick={(e) => e.stopPropagation()}>
            <motion.button whileTap={{ scale: 0.8 }} onClick={handleLike} className={`flex items-center gap-1 ${liked ? 'text-red-500' : ''}`}>
              <Heart size={20} fill={liked ? 'currentColor' : 'none'} /> {likes}
            </motion.button>
            <motion.button whileTap={{ scale: 0.8 }} onClick={() => { setShowComments(!showComments); if (!showComments) loadComments(); }} className="flex items-center gap-1">
              <MessageCircle size={20} /> {post.commentCount || 0}
            </motion.button>
            <motion.button whileTap={{ scale: 0.8 }} onClick={handleShare} className="flex items-center gap-1">
              <Share2 size={20} />
            </motion.button>
          </div>

          {/* Комментарии (в ленте только превью) */}
          <AnimatePresence>
            {showComments && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t pt-3 space-y-3 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {comments.slice(0, 3).map(c => (
                  <div key={c.id} className="flex gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold">{c.user?.name?.[0] || '?'}</div>
                    <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-lg flex-1">
                      <p className="text-sm font-semibold">{c.user?.name}</p>
                      <p className="text-sm">{c.text}</p>
                    </div>
                  </div>
                ))}
                {comments.length > 3 && (
                  <p className="text-sm text-blue-600 cursor-pointer" onClick={() => navigate(`/posts/${post.id}`)}>
                    Показать все комментарии ({comments.length})
                  </p>
                )}
                <form onSubmit={submitComment} className="flex gap-2 mt-3">
                  <Input placeholder="Напишите комментарий..." value={newComment} onChange={e => setNewComment(e.target.value)} className="flex-1" />
                  <button type="submit" className="text-blue-600 font-medium">Отправить</button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Модальное окно изображения */}
          {selectedImage && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
              <button className="absolute top-4 right-4 text-white" onClick={() => setSelectedImage(null)}><X size={32} /></button>
              <img src={selectedImage} className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}