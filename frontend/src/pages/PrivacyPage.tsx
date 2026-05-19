import React from 'react';
import Card from '../components/ui/Card';

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Политика приватности</h1>
      <Card className="space-y-4 text-gray-700 dark:text-gray-300 leading-relaxed">
        <p>
          <strong>Дата последнего обновления:</strong> 19 мая 2026 г.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">1. Общие положения</h2>
        <p>
          Настоящая Политика конфиденциальности регулирует сбор, хранение и обработку персональных данных пользователей закрытого маркетплейса. Доступ к приложению возможен только по приглашениям.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">2. Какие данные мы собираем</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Телефон</strong> — обязательное поле, используется как логин и для связи.</li>
          <li><strong>Имя</strong> — обязательно, отображается в профиле, чате, комментариях.</li>
          <li><strong>Реферальный код</strong> — генерируется автоматически при регистрации.</li>
          <li><strong>Данные о заказах и транзакциях</strong> — сумма, статус, реферальные бонусы.</li>
          <li><strong>Технические данные:</strong> IP-адрес, push-токены, логи действий (по необходимости).</li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">3. Цели обработки данных</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Обеспечение работы маркетплейса (товары, заказы, чат).</li>
          <li>Начисление реферальных бонусов и комиссий.</li>
          <li>Модерация контента и чата.</li>
          <li>Отправка push-уведомлений о заказах, сообщениях и новых публикациях.</li>
          <li>Экспорт данных администратором (только CSV со списком пользователей).</li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">4. Хранение и защита данных</h2>
        <p>
          Все данные передаются только по HTTPS (TLS 1.2+). Сообщения чата обрабатываются через CometChat и модерируются на стороне сервера. Логи модерации хранятся отдельно от текста сообщений. Доступ к персональным данным имеет только администратор.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">5. Чат и конфиденциальность</h2>
        <p>
          Контакты пользователей не отображаются в чате. Передача телефонных номеров, email и ссылок блокируется автоматической модерацией. Сообщения хранятся в зашифрованном виде на серверах CometChat.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">6. Экспорт данных</h2>
        <p>
          Администратор может экспортировать список пользователей в CSV/XLS. Пользователь может запросить свои данные, обратившись в поддержку.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">7. Изменения в политике</h2>
        <p>
          Администрация оставляет за собой право вносить изменения в Политику приватности. Пользователи будут уведомлены через ленту новостей или push-уведомления.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">8. Контакты</h2>
        <p>
          По всем вопросам обращайтесь к администратору через чат поддержки.
        </p>
      </Card>
    </div>
  );
}