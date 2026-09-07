import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, MoreHorizontal, Megaphone, ExternalLink, Trash2, Edit3 } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';

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
    <div onClick={() => navigate(`/posts/${post.id}`)}
      className="group overflow-hidden cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:border-[#22c55e] transition-colors">

      <div className="p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#22c55e] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
            {(post.author?.name || post.adOwner?.name || 'A')[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text)]">{post.author?.name || post.adOwner?.name || 'Аноним'}</span>
              {post.isAd && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(255,213,102,0.12)] text-amber-300 text-[10px]">
                  <Megaphone size={10} /> Реклама
                </span>
              )}
            </div>
            <span className="text-[11px] text-[var(--color-muted)]">{time}</span>
          </div>
        </div>
        {isAdmin && (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-md hover:bg-[var(--bg-3)] text-[var(--color-muted)] transition-colors">
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <div className="absolute right-0 top-full mt-1.5 w-32 bg-[var(--card-2)] rounded-lg py-1 z-10 border border-[var(--color-border)]">
                {onEdit && <button onClick={() => { onEdit(post); setMenu(false); }} className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-muted)] hover:bg-[var(--bg-3)] w-full"><Edit3 size={12} /> Ред.</button>}
                {onDelete && <button onClick={() => { onDelete(post.id); setMenu(false); }} className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-[var(--bg-3)] w-full"><Trash2 size={12} /> Удалить</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3.5 pb-3.5">
        <h2 className="text-[15px] font-semibold mb-1.5 line-clamp-2 text-[var(--color-text)]">{post.title}</h2>
        {post.content && <p className="text-[13px] text-[var(--color-muted)] line-clamp-3 mb-2.5 leading-relaxed">{post.content}</p>}
        {media.length > 0 && (
          <div className="rounded-lg overflow-hidden mb-2.5">
            <img src={media[0]} alt={post.title} className="w-full h-48 object-cover" loading="lazy" />
          </div>
        )}
        {post.link && (
          <a href={post.link} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-[#22c55e] font-medium">
            <ExternalLink size={12} /> Ссылка
          </a>
        )}
      </div>

      <div className="px-3.5 pb-3 flex items-center gap-3 border-t border-[var(--color-border)] pt-2.5">
        <button onClick={handleLike} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${liked ? 'text-[#22c55e]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
          {likes > 0 && likes}
        </button>
        <button onClick={e => { e.stopPropagation(); navigate(`/posts/${post.id}`); }} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
          <MessageCircle size={14} />
          {post.commentCount > 0 && post.commentCount}
        </button>
      </div>
    </div>
  );
}
