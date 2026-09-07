import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { getComments, addComment, deleteComment, likePost, unlikePost } from '../api/social';
import { Heart, MessageCircle, ArrowLeft, Send, Megaphone, Trash2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { resolveMedia } from '../utils/media';
import toast from 'react-hot-toast';

export default function PostDetailPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [liked, setLiked] = useState(false); const [likes, setLikes] = useState(0);
  const [mediaIdx, setMediaIdx] = useState(0);

  useEffect(() => {
    Promise.all([api.get(`/posts/${id}`).then(r => r.data), getComments(id!)])
      .then(([p, c]) => { setPost(p); setComments(c); setLiked(p.likedByMe || false); setLikes(p.likeCount || 0); })
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLike = async () => { try { if (liked) { await unlikePost(id!); setLikes((c:number)=>c-1); } else { await likePost(id!); setLikes((c:number)=>c+1); } setLiked(!liked); } catch { /* ignore */ } };
  const handleComment = async () => { if (!commentText.trim()) return; try { const c = await addComment(id!, commentText); setComments(p => [...p, c]); setCommentText(''); } catch { toast.error('Ошибка'); } };
  const delComment = async (cid: string) => { try { await deleteComment(cid); setComments(p => p.filter(c => c.id !== cid)); } catch { toast.error('Ошибка'); } };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;
  if (!post) return <div className="text-center py-32"><p className="text-[var(--color-muted)]">Пост сняли. Может, автор передумал, может, что-то не зашло.</p></div>;

  const media = Array.isArray(post.media) ? post.media : typeof post.media === 'string' ? [post.media] : [];

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm"><ArrowLeft size={16} /> Назад</button>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[#0d1512] text-[11px] font-extrabold shrink-0 ${post.isAd ? 'bg-gradient-to-br from-[#22c55e] to-[#34d399]' : 'bg-[#22c55e]'}`}>{(post.author?.name||post.adOwner?.name||'A')[0].toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--color-text)]">{post.author?.name||post.adOwner?.name||'Аноним'}</span>
                  {post.isAd && <span className="text-[10px] text-[#0d1512] bg-[#22c55e] px-1.5 py-0.5 rounded-full font-extrabold uppercase flex items-center gap-1"><Megaphone size={10} /> Реклама</span>}
                </div>
                <span className="text-[11px] text-[var(--color-muted)]">{post.createdAt ? format(new Date(post.createdAt), 'd MMMM в HH:mm', { locale: ru }) : ''}</span>
              </div>
            </div>
            <h1 className="text-xl font-extrabold text-[var(--color-text)] mb-3">{post.title}</h1>
            {post.content && <p className="text-[var(--color-muted)] text-sm leading-relaxed mb-4">{post.content}</p>}
            {post.link && <a href={post.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#22c55e] hover:text-[#34d399] mb-4 break-all underline underline-offset-2"><ExternalLink size={12} /> {post.link}</a>}
            {media.length > 0 && (
              <div className="relative -mx-6 mb-4">
                <div className="relative w-full overflow-hidden">
                  <img src={resolveMedia(media[mediaIdx])} alt="" className="w-full max-h-[480px] object-cover" />
                  {media.length > 1 && (
                    <>
                      <button
                        onClick={() => setMediaIdx((mediaIdx - 1 + media.length) % media.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => setMediaIdx((mediaIdx + 1) % media.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                      >
                        <ChevronRight size={18} />
                      </button>
                      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {media.map((_: string, i: number) => (
                          <span key={i} className={`h-1.5 rounded-full transition-all ${i === mediaIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-2.5">
              <button onClick={handleLike} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${liked?'text-[#22c55e] bg-[rgba(34,197,94,0.1)]':'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)]'}`}><Heart size={14} fill={liked?'currentColor':'none'}/>{likes>0&&likes}</button>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)] transition-colors"><MessageCircle size={14} />{comments.length}</div>
            </div>
          </div>
        </motion.div>

        <div className="mt-8">
          <h3 className="text-base font-extrabold text-[var(--color-text)] mb-4">Свои пишут ({comments.length})</h3>
          <div className="space-y-2 mb-6">
            {comments.map((c,i)=>(
              <motion.div key={c.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.02}} className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#22c55e] to-[#34d399] text-[#0d1512] text-[9px] font-extrabold flex items-center justify-center shrink-0">{(c.user?.name||'?')[0].toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1"><span className="text-xs font-bold text-[var(--color-text)]">{c.user?.name||'Аноним'}</span><span className="text-[10px] text-[var(--color-faint)]">{c.createdAt ? format(new Date(c.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</span></div>
                    <p className="text-xs text-[var(--color-muted)]">{c.text}</p>
                  </div>
                  {(c.userId===user?.id||isAdmin)&&<button onClick={()=>delComment(c.id)} className="text-[var(--color-faint)] hover:text-red-400 transition-colors"><Trash2 size={13}/></button>}
                </div>
              </motion.div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleComment()} placeholder="Впишись в движ..." className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all" />
            <button onClick={handleComment} className="px-5 py-3 rounded-xl bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all flex items-center gap-1.5"><Send size={14}/>Погнали</button>
          </div>
        </div>
      </div>
    </div>
  );
}