import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { getComments, addComment, deleteComment, likePost, unlikePost } from '../api/social';
import { Heart, MessageCircle, ArrowLeft, Send, Megaphone, Trash2, ExternalLink, ChevronLeft, ChevronRight, Loader2, User } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { resolveMedia } from '../utils/media';
import { buildGallery } from '../utils/video';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/error';

export default function PostDetailPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [liked, setLiked] = useState(false); const [likes, setLikes] = useState(0);
  const [mediaIdx, setMediaIdx] = useState(0);
  // A5.4: одна отправка на клик. `sending` — источник правды для disabled и для
  // guard'а в обработчике: 20 кликов по кнопке больше не дают 20 комментариев.
  const [sending, setSending] = useState(false);
  // id комментариев, по которым уже идёт удаление — кнопка блокируется,
  // чтобы повторный клик не отправлял второй DELETE и не «оживлял» строку.
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // A5.4: СИНХРОННЫЙ guard от повторной отправки.
  //
  // `sending` — React state, а state обновляется асинхронно: при пачке
  // синхронных кликов (быстрые тапы, программный .click()) все обработчики
  // читают ещё `false` из одного и того же замыкания рендера — 20 кликов
  // проходили в сеть (живой тест: 2 комментария вместо 1). Ref меняется
  // немедленно, поэтому второй и последующие клики внутри той же пачки
  // отсекаются до того, как дойдёт до `await`.
  const sendingRef = useRef(false);

  useEffect(() => {
    Promise.all([api.get(`/posts/${id}`).then(r => r.data), getComments(id!)])
      .then(([p, c]) => { setPost(p); setComments(c); setLiked(p.likedByMe || false); setLikes(p.likeCount || 0); })
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLike = async () => { try { if (liked) { await unlikePost(id!); setLikes((c:number)=>c-1); } else { await likePost(id!); setLikes((c:number)=>c+1); } setLiked(!liked); } catch { /* ignore */ } };

  /**
   * A5.4: отправка комментария.
   *
   * Раньше: `await addComment(...)` → `setComments([...p, c])`. При 20 кликах
   * уходило 20 запросов, ответы приходили вразнобой, и список дёргался —
   * «всё лагало, потом медленно начал вставлять комменты».
   *
   * Теперь: guard по `sending` (второй клик — no-op), оптимистичная вставка
   * с временным id (комментарий виден сразу, без ожидания сети) и замена на
   * реальный объект из ответа. При ошибке временный комментарий убирается,
   * текст возвращается в поле — ничего не теряется.
   */
  const handleComment = async () => {
    const text = commentText.trim();
    // Ref — синхронный барьер; `sending` оставляем для UI (disabled/спиннер).
    if (!text || sendingRef.current) return;
    sendingRef.current = true;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: tempId,
      text,
      userId: user?.id,
      user: { id: user?.id, name: 'Вы' },
      postId: id,
      createdAt: new Date().toISOString(),
      _pending: true,
    };

    setSending(true);
    setComments(prev => [...prev, optimistic]);
    setCommentText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const created = await addComment(id!, text);
      setComments(prev => prev.map(c => (c.id === tempId ? created : c)));
      toast.success('Комментарий отправлен');
    } catch (e) {
      setComments(prev => prev.filter(c => c.id !== tempId));
      setCommentText(text);
      toast.error(errorMessage(e, 'Комментарий не отправился'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  /**
   * A5.4: удаление комментария.
   *
   * Раньше при ошибке список не менялся, а повторный клик слал второй DELETE —
   * «то нажимаешь исчезает коммент, то не исчезает». Теперь удаляем
   * оптимистично (строка исчезает сразу), блокируем повторный клик на время
   * запроса и откатываем строку назад ровно в исходную позицию, если сервер
   * отказал.
   */
  const delComment = async (cid: string) => {
    if (deletingIds.includes(cid)) return;
    const index = comments.findIndex(c => c.id === cid);
    if (index === -1) return;
    const removed = comments[index];

    setDeletingIds(prev => [...prev, cid]);
    setComments(prev => prev.filter(c => c.id !== cid));
    try {
      await deleteComment(cid);
      toast.success('Комментарий удалён');
    } catch (e) {
      setComments(prev => {
        if (prev.some(c => c.id === cid)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, removed);
        return next;
      });
      toast.error(errorMessage(e, 'Не удалось удалить комментарий'));
    } finally {
      setDeletingIds(prev => prev.filter(x => x !== cid));
    }
  };

  // Единая галерея: видео первым слайдом, фото после. Считаем ДО ранних return'ов,
  // чтобы не нарушать порядок хуков.
  const gallery = useMemo(
    () => (post ? buildGallery(post.media, post.videoUrl) : []),
    [post],
  );
  const total = gallery.length;
  const idx = total > 0 ? ((mediaIdx % total) + total) % total : 0;
  const current = total > 0 ? gallery[idx] : null;
  const nextSlide = total > 1 ? gallery[(idx + 1) % total] : null;

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;
  if (!post) return <div className="text-center py-32"><p className="text-[var(--color-muted)]">Пост сняли. Может, автор передумал, может, что-то не зашло.</p></div>;

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
                  {/* A5.8: автор ведёт на публичный профиль */}
                  {(() => {
                    const authorId = post.author?.id || post.adOwner?.id;
                    const authorName = post.author?.name || post.adOwner?.name || 'Аноним';
                    return authorId ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/users/${authorId}`)}
                        className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-text)] hover:text-[#22c55e] transition-colors underline underline-offset-2 decoration-[var(--color-border)] hover:decoration-[#22c55e]"
                      >
                        {authorName}
                        <User size={12} className="opacity-60" />
                      </button>
                    ) : (
                      <span className="text-sm font-bold text-[var(--color-text)]">{authorName}</span>
                    );
                  })()}
                  {post.isAd && <span className="text-[10px] text-[#0d1512] bg-[#22c55e] px-1.5 py-0.5 rounded-full font-extrabold uppercase flex items-center gap-1"><Megaphone size={10} /> Реклама</span>}
                </div>
                <span className="text-[11px] text-[var(--color-muted)]">{post.createdAt ? format(new Date(post.createdAt), 'd MMMM в HH:mm', { locale: ru }) : ''}</span>
              </div>
            </div>
            <h1 className="text-xl font-extrabold text-[var(--color-text)] mb-3">{post.title}</h1>
            {post.content && <p className="text-[var(--color-muted)] text-sm leading-relaxed mb-4">{post.content}</p>}
            {post.link && <a href={post.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#22c55e] hover:text-[#34d399] mb-4 break-all underline underline-offset-2"><ExternalLink size={12} /> {post.link}</a>}

            {/* ЕДИНАЯ ГАЛЕРЕЯ: видео первым слайдом, фото после. */}
            {total > 0 && (
              <div className="relative -mx-6 mb-4 bg-black">
                <div className="relative w-full overflow-hidden">
                  {/* Предзагрузка следующего слайда — убирает «медленную прогрузку». */}
                  {nextSlide && nextSlide.type === 'image' && (
                    <link rel="preload" as="image" href={resolveMedia(nextSlide.src)} />
                  )}

                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="relative"
                  >
                    {current?.type === 'video' ? (
                      <video
                        src={resolveMedia(current.src)}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-[480px] bg-black"
                      />
                    ) : current?.type === 'embed' ? (
                      <iframe
                        src={current.src}
                        title={current.label || 'Видео'}
                        allowFullScreen
                        className="w-full aspect-video bg-black"
                      />
                    ) : current ? (
                      <img
                        src={resolveMedia(current.src)}
                        alt={post.title}
                        loading={idx === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        fetchPriority={idx === 0 ? 'high' : 'auto'}
                        className="w-full max-h-[480px] object-cover"
                      />
                    ) : null}
                  </motion.div>

                  {total > 1 && (
                    <>
                      <button
                        onClick={() => setMediaIdx((idx - 1 + total) % total)}
                        aria-label="Предыдущий слайд"
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => setMediaIdx((idx + 1) % total)}
                        aria-label="Следующий слайд"
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                      >
                        <ChevronRight size={18} />
                      </button>
                      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                        {gallery.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setMediaIdx(i)}
                            aria-label={`Слайд ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all duration-200 ${i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                          />
                        ))}
                        {current?.type === 'video' && (
                          <span className="ml-1 text-[10px] font-bold uppercase text-white/80">видео</span>
                        )}
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
              <motion.div key={c.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.02}} className={`rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 transition-opacity ${c._pending || deletingIds.includes(c.id) ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#22c55e] to-[#34d399] text-[#0d1512] text-[9px] font-extrabold flex items-center justify-center shrink-0">{(c.user?.name||'?')[0].toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-[var(--color-text)]">{c.user?.name||'Аноним'}</span>
                      <span className="text-[10px] text-[var(--color-faint)]">{c.createdAt ? format(new Date(c.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</span>
                      {c._pending && <span className="text-[10px] text-[var(--color-muted)]">отправка…</span>}
                    </div>
                    <p className="text-xs text-[var(--color-muted)] break-words">{c.text}</p>
                  </div>
                  {(c.userId===user?.id||isAdmin)&&(
                    <button
                      type="button"
                      onClick={()=>delComment(c.id)}
                      disabled={deletingIds.includes(c.id) || c._pending}
                      aria-label="Удалить комментарий"
                      title="Удалить комментарий"
                      className="shrink-0 w-11 h-11 -m-2.5 flex items-center justify-center rounded-lg text-[var(--color-faint)] hover:text-red-400 hover:bg-red-400/10 disabled:opacity-40 transition-colors"
                    >
                      {deletingIds.includes(c.id) ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14}/>}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
            {comments.length === 0 && (
              <p className="text-xs text-[var(--color-muted)] py-4">Пока тихо. Будь первым.</p>
            )}
          </div>
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={commentText}
              onChange={e=>setCommentText(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleComment(); } }}
              rows={1}
              placeholder="Впишись в движ..."
              aria-label="Текст комментария"
              className="flex-1 min-w-0 resize-none px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all"
            />
            <button
              type="button"
              onClick={handleComment}
              disabled={sending || !commentText.trim()}
              className="shrink-0 px-5 min-h-[48px] rounded-xl bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
            >
              {sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              {sending ? 'Шлём…' : 'Погнали'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}