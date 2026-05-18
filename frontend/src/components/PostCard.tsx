import React, { useState } from 'react';
import { Heart, MessageCircle, Share2, MoreHorizontal, X, Play } from 'lucide-react';
import ReactPlayer from 'react-player';
import Card from './ui/Card';
import { likePost, unlikePost, getComments, addComment } from '../api/social';
import Input from './ui/Input';
import { format } from 'date-fns'; // установим date-fns
import { ru } from 'date-fns/locale';

export default function PostCard({ post, onLikeUpdate }: any) {
  const [likes, setLikes] = useState(post.likeCount);
  const [liked, setLiked] = useState(post.likedByMe);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
            {post.author?.name?.[0] || 'A'}
          </div>
          <div>
            <h4 className="font-semibold">{post.author?.name}</h4>
            <p className="text-xs text-gray-500">{format(new Date(post.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}</p>
          </div>
        </div>
        <button className="p-1"><MoreHorizontal size={18} className="text-gray-400" /></button>
      </div>
      <p className="text-gray-700 dark:text-gray-300">{post.content}</p>
      {post.media && post.media.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {post.media.map((url: string, idx: number) => (
            <img key={idx} src={url} className="rounded-xl cursor-pointer hover:opacity-90 object-cover h-48 w-full" onClick={() => setSelectedImage(url)} />
          ))}
        </div>
      )}
      {post.videoUrl && (
        <div className="rounded-xl overflow-hidden">
          <ReactPlayer url={post.videoUrl} width="100%" height="300px" controls light={post.media?.[0] || true} playIcon={<div className="absolute inset-0 flex items-center justify-center"><Play size={48} className="text-white bg-black/30 rounded-full p-2" /></div>} />
        </div>
      )}
      <div className="flex items-center gap-6 text-gray-500">
        <button onClick={handleLike} className={`flex items-center gap-1 ${liked ? 'text-red-500' : ''}`}>
          <Heart size={20} fill={liked ? 'currentColor' : 'none'} /> {likes}
        </button>
        <button onClick={() => { setShowComments(!showComments); if (!showComments) loadComments(); }} className="flex items-center gap-1">
          <MessageCircle size={20} /> {post.commentCount || 0}
        </button>
        <button className="flex items-center gap-1"><Share2 size={20} /></button>
      </div>
      {showComments && (
        <div className="border-t pt-3 space-y-3">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold">{c.user.name?.[0]}</div>
              <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-lg flex-1">
                <p className="text-sm font-semibold">{c.user.name}</p>
                <p className="text-sm">{c.text}</p>
              </div>
            </div>
          ))}
          <form onSubmit={submitComment} className="flex gap-2 mt-3">
            <Input placeholder="Напишите комментарий..." value={newComment} onChange={e => setNewComment(e.target.value)} className="flex-1" />
            <button type="submit" className="text-blue-600 font-medium">Отправить</button>
          </form>
        </div>
      )}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setSelectedImage(null)}><X size={32} /></button>
          <img src={selectedImage} className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </Card>
  );
}