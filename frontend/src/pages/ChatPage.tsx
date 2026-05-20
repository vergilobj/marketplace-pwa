import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Send, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Conversation {
  conversationId: string;
  conversationWith: { uid: string; name: string; avatar?: string };
  lastMessage: { text: string };
  unreadMessageCount: number;
}

interface Message {
  id: string;
  sender: { uid: string; name: string };
  text: string;
  type: string;
  data?: { url?: string };
  sentAt: number;
}

export default function ChatPage() {
  const [searchParams] = useSearchParams();
  const uidFromUrl = searchParams.get('uid');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(uidFromUrl || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userId = localStorage.getItem('userId');

  // Загрузка бесед
  useEffect(() => {
    const conversationsRequest = new CometChat.ConversationsRequestBuilder()
      .setLimit(30)
      .build();

    conversationsRequest.fetchNext().then(
      (convList: any[]) => {
        setConversations(convList.map((conv: any) => ({
          conversationId: conv.getConversationId(),
          conversationWith: {
            uid: conv.getConversationWith().getUid(),
            name: conv.getConversationWith().getName(),
            avatar: conv.getConversationWith().getAvatar?.() || undefined,
          },
          lastMessage: {
            text: conv.getLastMessage()?.getText?.() || (conv.getLastMessage()?.getType?.() === 'image' ? '📷 Фото' : ''),
          },
          unreadMessageCount: conv.getUnreadMessageCount(),
        })));
      },
      error => console.error('Failed to load conversations', error)
    );
  }, []);

  // Загрузка сообщений и слушатели
  useEffect(() => {
    if (!selectedUser) return;

    const messagesRequest = new CometChat.MessagesRequestBuilder()
      .setUID(selectedUser)
      .setLimit(50)
      .build();

    messagesRequest.fetchPrevious().then(
      (msgs: any[]) => {
        setMessages(msgs.map(mapMessage));
        scrollToBottom();
      },
      error => console.error('Failed to load messages', error)
    );

    const msgListenerId = `chat_msg_${selectedUser}`;
    CometChat.addMessageListener(
      msgListenerId,
      new CometChat.MessageListener({
        onTextMessageReceived: (textMessage: any) => {
          if (textMessage.getSender().getUid() === selectedUser) {
            setMessages(prev => [...prev, mapMessage(textMessage)]);
            scrollToBottom();
          }
        },
        onMediaMessageReceived: (mediaMessage: any) => {
          if (mediaMessage.getSender().getUid() === selectedUser) {
            setMessages(prev => [...prev, mapMessage(mediaMessage)]);
            scrollToBottom();
          }
        },
        onTypingStarted: (typingIndicator: any) => {
          if (typingIndicator.getSender().getUid() === selectedUser) {
            setIsTyping(true);
          }
        },
        onTypingEnded: (typingIndicator: any) => {
          if (typingIndicator.getSender().getUid() === selectedUser) {
            setIsTyping(false);
          }
        },
      })
    );

    return () => {
      CometChat.removeMessageListener(msgListenerId);
    };
  }, [selectedUser]);

  // Отслеживание онлайна
  useEffect(() => {
    const listenerId = `user_status_${Date.now()}`;
    CometChat.addUserListener(
      listenerId,
      new CometChat.UserListener({
        onUserOnline: (user: any) => {
          setOnlineUsers(prev => new Set(prev).add(user.getUid()));
        },
        onUserOffline: (user: any) => {
          setOnlineUsers(prev => {
            const next = new Set(prev);
            next.delete(user.getUid());
            return next;
          });
        },
      })
    );

    return () => CometChat.removeUserListener(listenerId);
  }, []);

  const mapMessage = (msg: any): Message => ({
    id: msg.getId(),
    sender: {
      uid: msg.getSender().getUid(),
      name: msg.getSender().getName(),
    },
    text: msg.getText?.() || '',
    type: msg.getType?.() || 'text',
    data: msg.getData?.() || undefined,
    sentAt: msg.getSentAt(),
  });

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const sendText = async () => {
    if (!newMessage.trim() || !selectedUser) return;
    const textMessage = new CometChat.TextMessage(
      selectedUser,
      newMessage.trim(),
      CometChat.RECEIVER_TYPE.USER
    );
    try {
      const sent = await CometChat.sendMessage(textMessage);
      setMessages(prev => [...prev, mapMessage(sent)]);
      setNewMessage('');
      scrollToBottom();
    } catch (error) {
      console.error('Send failed', error);
    }
  };

  const sendImage = async (file: File) => {
    if (!selectedUser) return;
    const mediaMessage = new CometChat.MediaMessage(
      selectedUser,
      file,
      CometChat.MESSAGE_TYPE.IMAGE,
      CometChat.RECEIVER_TYPE.USER
    );
    try {
      const sent = await CometChat.sendMediaMessage(mediaMessage);
      setMessages(prev => [...prev, mapMessage(sent)]);
      scrollToBottom();
    } catch (error) {
      console.error('Image send failed', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) sendImage(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startTyping = () => {
    if (selectedUser) {
      const typingNotification = new CometChat.TypingIndicator(
        selectedUser,
        CometChat.RECEIVER_TYPE.USER
      );
      CometChat.startTyping(typingNotification);
    }
  };

  const stopTyping = () => {
    if (selectedUser) {
      const typingNotification = new CometChat.TypingIndicator(
        selectedUser,
        CometChat.RECEIVER_TYPE.USER
      );
      CometChat.endTyping(typingNotification);
    }
  };

  let typingTimer: ReturnType<typeof setTimeout>;
  const handleTyping = () => {
    startTyping();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2000);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Чат</h1>
      <Card className="p-0 overflow-hidden">
        <div className="flex h-[75vh]">
          {/* Список бесед */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            {conversations.map(conv => (
              <motion.div
                key={conv.conversationId}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedUser(conv.conversationWith.uid)}
                className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition ${
                  selectedUser === conv.conversationWith.uid ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
                      {conv.conversationWith.name?.[0] || 'U'}
                    </div>
                    {onlineUsers.has(conv.conversationWith.uid) && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{conv.conversationWith.name}</p>
                    <p className="text-sm text-gray-500 truncate">{conv.lastMessage.text}</p>
                  </div>
                </div>
              </motion.div>
            ))}
            {conversations.length === 0 && (
              <div className="p-4 text-center text-gray-500">Нет диалогов</div>
            )}
          </div>

          {/* Сообщения */}
          <div className="w-2/3 flex flex-col">
            {selectedUser ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <AnimatePresence>
                    {messages.map(msg => {
                      const isMine = msg.sender.uid === userId;
                      const isImage = msg.type === 'image';
                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                          className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[70%] p-3 rounded-2xl ${
                              isMine
                                ? 'bg-blue-600 text-white rounded-br-md'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-md'
                            }`}
                          >
                            {isImage ? (
                              <img
                                src={msg.data?.url}
                                alt="attachment"
                                className="max-w-full rounded-lg"
                                loading="lazy"
                              />
                            ) : (
                              <p className="text-sm">{msg.text}</p>
                            )}
                            <p className="text-xs mt-1 opacity-70">
                              {new Date(msg.sentAt * 1000).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm text-gray-400 italic pl-2"
                    >
                      Печатает...
                    </motion.div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2"
                    >
                      <Paperclip size={18} />
                    </Button>
                    <Input
                      value={newMessage}
                      onChange={(e) => {
                        setNewMessage(e.target.value);
                        handleTyping();
                      }}
                      placeholder="Введите сообщение..."
                      className="flex-1"
                    />
                    <Button variant="primary" size="sm" onClick={sendText} className="p-2">
                      <Send size={18} />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                Выберите чат, чтобы начать общение
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}