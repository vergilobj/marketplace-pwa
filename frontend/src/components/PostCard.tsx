import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, MoreHorizontal, Megaphone, ExternalLink, Trash2, Edit3, Play } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { resolveMedia } from '../utils/media';
import { buildGallery } from '../utils/video';
import Badge from './ui/Badge';
import type { ApiPost } from '../api/types';

interface Props {
  post: ApiPost;
  onDelete?: (id: string) => void;
  onEdit?: (post: ApiPost) => void;
}

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

  // Единая галерея: видео первым слайдом, фото после.
  const gallery = useMemo(
    () => buildGallery(post.media as string[] | string | null, post.videoUrl),
    [post.media, post.videoUrl],
  );
  const first = gallery[0] || null;
  const extraCount = gallery.length - 1;
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
                <Badge tone="amber" text="Реклама" icon={<Megaphone size={11} />} />
              )}
            </div>
            <span className="text-[11px] text-[var(--color-muted)]">{time}</span>
          </div>
        </div>
        {isAdmin && (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMenu(!menu)} aria-label="Меню" className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-[var(--bg-3)] text-[var(--color-muted)] transition-colors -mr-2">
              <MoreHorizontal size={17} />
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

        {first && (
          <div className="relative rounded-lg overflow-hidden mb-2.5 bg-black">
            {first.type === 'video' ? (
              <video
                src={resolveMedia(first.src)}
                controls
                playsInline
                preload="metadata"
                className="w-full h-48 object-contain bg-black"
              />
            ) : first.type === 'embed' ? (
              <div className="relative w-full h-48 bg-black flex items-center justify-center">
                <Play size={32} className="text-white/70" />
              </div>
            ) : (
              <img
                src={resolveMedia(first.src)}
                alt={post.title}
                className="w-full h-48 object-cover"
                loading="lazy"
                decoding="async"
                width={640}
                height={360}
                style={{ aspectRatio: '16 / 9' }}
              />
            )}
            {extraCount > 0 && (
              <span className="absolute bottom-2 right-2 text-[11px] font-semibold text-white bg-black/60 rounded-full px-2 py-0.5">
                +{extraCount}
              </span>
            )}
          </div>
        )}

        {post.link && (
          <a href={post.link} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-[#22c55e] font-medium">
            <ExternalLink size={12} /> Ссылка
          </a>
        )}
      </div>

      <div className="px-3.5 pb-3 flex items-center gap-1 border-t border-[var(--color-border)] pt-1.5">
        <button onClick={handleLike} aria-label="Нравится" className={`flex items-center gap-1.5 px-2.5 min-h-[44px] rounded-md text-xs transition-colors ${liked ? 'text-[#22c55e]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
          {likes > 0 && likes}
        </button>
        <button onClick={e => { e.stopPropagation(); navigate(`/posts/${post.id}`); }} aria-label="Комментарии" className="flex items-center gap-1.5 px-2.5 min-h-[44px] rounded-md text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
          <MessageCircle size={15} />
          {post.commentCount ? post.commentCount : null}
        </button>
      </div>
    </div>
  );
}