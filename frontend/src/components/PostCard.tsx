import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, MoreHorizontal, Megaphone, ExternalLink, Trash2, Edit3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';

const GS = { background: 'linear-gradient(135deg, #fbfbf8 0%, #a8b0a8 50%, #a8b0a8 100%)' } as const;

interface Props { post: any; onDelete?: (id: string) => void; onEdit?: (post: any) => void; }

export default function PostCard({ post, onDelete, onEdit }: Props) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [liked, setLiked] = useState(post.likedByMe || false);
  const [likes, setLikes] = useState(post.likeCount || 0);
  const [menu, setMenu] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (liked) { await api.delete(`/social/${post.id}/like`); setLikes((c: number) => c - 1); }
      else { await api.post(`/social/${post.id}/like`); setLikes((c: number) => c + 1); }
      setLiked(!liked);
    } catch { toast.error('Не удалось'); }
  };

  const media = Array.isArray(post.media) ? post.media : typeof post.media === 'string' ? [post.media] : [];
  const time = post.createdAt ? format(new Date(post.createdAt), 'd MMM, HH:mm', { locale: ru }) : '';

  return (
    <motion.div whileHover={{ y: -4 }} onClick={() => navigate(`/posts/${post.id}`)}
      className="group glass-card overflow-hidden cursor-pointer p-0">

      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div style={GS} className="w-9 h-9 rounded-full text-[#0b0e0d] text-[11px] font-bold flex items-center justify-center shrink-0 shadow-md">
            {(post.author?.name || post.adOwner?.name || 'A')[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text)]">{post.author?.name || post.adOwner?.name || 'Аноним'}</span>
              {post.isAd && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(255,213,102,0.12)] text-amber-300 text-[10px] font-semibold">
                  <Megaphone size={10} /> Реклама
                </span>
              )}
            </div>
            <span className="text-[11px] text-[var(--color-muted)]">{time}</span>
          </div>
        </div>
        {isAdmin && (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <div className="absolute right-0 top-full mt-2 w-32 glass-strong rounded-xl shadow-2xl py-1 z-10 border border-[rgba(255,255,255,0.08)]">
                {onEdit && <button onClick={() => { onEdit(post); setMenu(false); }} className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.05)] w-full"><Edit3 size={12} /> Ред.</button>}
                {onDelete && <button onClick={() => { onDelete(post.id); setMenu(false); }} className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-[rgba(255,255,255,0.05)] w-full"><Trash2 size={12} /> Удалить</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-4">
        <h2 className="text-base font-bold mb-2 line-clamp-2 text-[var(--color-text)] group-hover:text-[#fbfbf8] transition-colors">{post.title}</h2>
        {post.content && <p className="text-sm text-[var(--color-muted)] line-clamp-3 mb-3 leading-relaxed">{post.content}</p>}
        {media.length > 0 && (
          <div className="rounded-xl overflow-hidden mb-3">
            <img src={media[0]} alt={post.title} className="w-full h-52 object-cover group-hover:scale-[1.03] transition-transform duration-500" loading="lazy" />
          </div>
        )}
        {post.link && (
          <a href={post.link} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-[#fbfbf8] hover:text-[#e8eae8] font-medium">
            <ExternalLink size={12} /> Ссылка
          </a>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex items-center gap-4">
        <button onClick={handleLike} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${liked ? 'text-[#fbfbf8] bg-[rgba(201,242,103,0.1)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.04)]'}`}>
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
          {likes > 0 && likes}
        </button>
        <button onClick={e => { e.stopPropagation(); navigate(`/posts/${post.id}`); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.04)] transition-all">
          <MessageCircle size={14} />
          {post.commentCount > 0 && post.commentCount}
        </button>
      </div>
    </motion.div>
  );
}