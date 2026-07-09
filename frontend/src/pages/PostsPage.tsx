import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import { getPosts } from '../api/posts';
import Card from '../components/ui/Card';

export default function PostsPage() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPosts()
      .then(setPosts)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Лента</h1>
      {loading && <p className="text-center text-gray-500">Загрузка...</p>}
      <div className="space-y-4">
        {posts.map((p: any) => (
          <Card key={p.id} className={p.isPinned ? 'border-l-4 border-l-blue-500' : ''}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {p.isAd && <Megaphone className="w-4 h-4 text-orange-500" />}
                  {p.isPinned && <Pin className="w-4 h-4 text-blue-500" />}
                  <h3 className="font-semibold text-lg">{p.title}</h3>
                </div>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{p.content}</p>
                {p.link && <a href={p.link} className="text-blue-600 text-sm mt-1 block">Подробнее</a>}
                {p.isAd && <span className="text-xs text-orange-600 font-medium mt-2 inline-block">Реклама</span>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}