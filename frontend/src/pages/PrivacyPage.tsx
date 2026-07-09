import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <button onClick={()=>navigate(-1)} className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-8 transition-colors text-sm"><ArrowLeft size={16}/>Назад</button>
      <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-8">
        <div className="flex items-center gap-4 mb-6"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Shield size={20} className="text-white"/></div><h1 className="text-xl font-bold text-white">Политика конфиденциальности</h1></div>
        <div className="space-y-4 text-sm leading-relaxed text-white/50">
          <p>Мы уважаем вашу приватность и обязуемся защищать ваши персональные данные.</p>
          <h3 className="text-white font-semibold text-base">Сбор данных</h3><p>Мы собираем только данные необходимые для работы сервиса: номер телефона, имя, информация о заказах и сообщениях.</p>
          <h3 className="text-white font-semibold text-base">Использование данных</h3><p>Ваши данные используются для обеспечения работы маркетплейса, обработки заказов, отправки уведомлений и улучшения сервиса.</p>
          <h3 className="text-white font-semibold text-base">Защита данных</h3><p>Мы применяем современные методы шифрования и защиты данных. Доступ к данным имеют только авторизованные сотрудники.</p>
        </div>
      </motion.div>
    </div>
  );
}
