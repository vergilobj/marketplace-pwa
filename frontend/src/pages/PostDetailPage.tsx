import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { getComments, addComment, deleteComment, likePost, unlikePost } from '../api/social';
import { Heart, MessageCircle, ArrowLeft, Send, Megaphone, Trash2, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function PostDetailPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [liked, setLiked] = useState(false); const [likes, setLikes] = useState(0);

  useEffect(() => {
    Promise.all([api.get(`/posts/${id}`).then(r => r.data), getComments(id!)])
      .then(([p, c]) => { setPost(p); setComments(c); setLiked(p.likedByMe || false); setLikes(p.likeCount || 0); })
      .finally(() => setLoading(false));
  }, [id]);

  const handleLike = async () => { try { if (liked) { await unlikePost(id!); setLikes((c:number)=>c-1); } else { await likePost(id!); setLikes((c:number)=>c+1); } setLiked(!liked); } catch { /* ignore */ } };
  const handleComment = async () => { if (!commentText.trim()) return; try { const c = await addComment(id!, commentText); setComments(p => [...p, c]); setCommentText(''); } catch { toast.error('Ошибка'); } };
  const delComment = async (cid: string) => { try { await deleteComment(cid); setComments(p => p.filter(c => c.id !== cid)); } catch { toast.error('Ошибка'); } };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;
  if (!post) return <div className="text-center py-32"><p className="text-white/50">Пост не найден</p></div>;

  const media = Array.isArray(post.media) ? post.media : typeof post.media === 'string' ? [post.media] : [];

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-6 transition-colors text-sm"><ArrowLeft size={16} /> Назад</button>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-[11px] font-bold flex items-center justify-center">{(post.author?.name||post.adOwner?.name||'A')[0].toUpperCase()}</div>
            <div><div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">{post.author?.name||post.adOwner?.name||'Аноним'}</span>{post.isAd && <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full"><Megaphone size={10} /> Реклама</span>}</div><span className="text-[11px] text-white/50">{post.createdAt ? format(new Date(post.createdAt), 'd MMMM в HH:mm', { locale: ru }) : ''}</span></div>
          </div>
          <h1 className="text-xl font-bold text-white mb-3">{post.title}</h1>
          {post.content && <p className="text-white/50 text-sm leading-relaxed mb-4">{post.content}</p>}
          {post.link && <a href={post.link} target="_blank" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mb-4"><ExternalLink size={12} /> Ссылка</a>}
          {media.length > 0 && <div className="rounded-xl overflow-hidden mb-4">{media.map((url:string,i:number)=><img key={i} src={url} alt="" className="w-full max-h-96 object-cover" />)}</div>}

          <div className="flex items-center gap-4 pt-4 border-t border-white/[0.06]">
            <button onClick={handleLike} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${liked?'text-rose-400 bg-rose-400/10':'text-white/60 hover:text-white hover:bg-white/[0.04]'}`}><Heart size={14} fill={liked?'currentColor':'none'}/>{likes>0&&likes}</button>
            <div className="flex items-center gap-1.5 text-xs text-white/60"><MessageCircle size={14} />{comments.length}</div>
          </div>
        </div>
      </motion.div>

      {/* Comments */}
      <div className="mt-8"><h3 className="text-base font-bold text-white mb-4">Комментарии ({comments.length})</h3>
        <div className="space-y-2 mb-6">{comments.map((c,i)=><motion.div key={c.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.02}} className="bg-[#1a1a24] border border-white/[0.04] rounded-xl p-4"><div className="flex items-start gap-3"><div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">{(c.user?.name||'?')[0].toUpperCase()}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-white">{c.user?.name||'Аноним'}</span><span className="text-[10px] text-white/35">{c.createdAt ? format(new Date(c.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</span></div><p className="text-xs text-white/50">{c.text}</p></div>{(c.userId===user?.id||isAdmin)&&<button onClick={()=>delComment(c.id)} className="text-white/35 hover:text-red-400 transition-colors"><Trash2 size={13}/></button>}</div></motion.div>)}</div>
        <div className="flex gap-2"><input value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleComment()} placeholder="Написать комментарий..." className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/35 outline-none focus:border-indigo-500/50 transition-all" /><button onClick={handleComment} className="px-5 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 transition-all flex items-center gap-1.5"><Send size={14}/>Отпр.</button></div>
      </div>
    </div>
  );
}
