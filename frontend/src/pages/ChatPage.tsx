import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

export default function ChatPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white mb-2">Чат</h1>
        <p className="text-white/40 text-sm mb-8">Общайтесь с продавцами и покупателями</p>
      </motion.div>
      <div className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-400/10 flex items-center justify-center"><MessageCircle size={28} className="text-indigo-400" /></div>
        <p className="text-white/50 text-sm">Чат загружается...</p>
        <p className="text-white/20 text-xs mt-2">Требуется авторизация CometChat</p>
      </div>
    </div>
  );
}
