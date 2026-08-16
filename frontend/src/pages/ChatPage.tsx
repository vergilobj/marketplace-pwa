import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Search, Send, ArrowLeft, Paperclip, Plus, X, UserPlus, Flag } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  getOrCreateIdentityKey,
  exportPublicKeyRaw,
  importPeerPublicKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
} from '../utils/crypto';

interface Conversation {
  userId: string;
  name: string;
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text?: string;
  ciphertext?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  createdAt: string;
  sender?: { id: string; name: string };
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

export default function ChatPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUid = searchParams.get('uid');

  const userId = useMemo(() => {
    try {
      const t = localStorage.getItem('accessToken');
      if (!t) return '';
      return JSON.parse(atob(t.split('.')[1])).sub || '';
    } catch { return ''; }
  }, []);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ userId: string; name: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [stopWords, setStopWords] = useState<string[]>([]);
  const [detectContacts, setDetectContacts] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sharedKeyCache = useRef<Map<string, CryptoKey>>(new Map());

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.name.toLowerCase().includes(q));
  }, [searchQuery, conversations]);

  // Auth check
  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
  }, [userId]);

  // Publish identity public key + load moderation rules on mount
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const kp = await getOrCreateIdentityKey();
        const pub = await exportPublicKeyRaw(kp.publicKey);
        await api.post('/chat/keys', { publicKey: pub });
      } catch (err) {
        console.error('Failed to publish chat public key', err);
      }
      try {
        const { data } = await api.get('/chat/moderation-rules');
        setStopWords(data.stopWords || []);
        setDetectContacts(data.detectContacts !== false);
      } catch (err) {
        console.error('Failed to load moderation rules', err);
      }
    })();
  }, [userId]);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/chat/conversations');
      setConversations(data);
      setLoading(false);
      return data;
    } catch { setLoading(false); return []; }
  }, []);

  // Socket connection
  useEffect(() => {
    if (!userId) return;
    const s = io(SOCKET_URL, {
      path: '/socket.io',
      auth: { token: localStorage.getItem('accessToken') },
      transports: ['websocket', 'polling'],
    });
    setSocket(s);

    s.on('connect', () => console.log('Socket connected'));

    s.on('newMessage', (msg: Message) => {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      decryptIncoming(msg).then((decrypted) => {
        if (selectedUser && selectedUser.userId === partnerId) {
          setMessages(prev => [...prev, decrypted]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          s.emit('markRead', { senderId: msg.senderId });
        }
        loadConversations();
      });
    });

    s.on('messageSent', (msg: Message) => {
      decryptIncoming(msg).then((decrypted) => {
        if (selectedUser && (msg.receiverId === selectedUser.userId || msg.senderId === selectedUser.userId)) {
          setMessages(prev => [...prev, decrypted]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
        loadConversations();
      });
    });

    loadConversations();
    return () => { s.disconnect(); };
  }, [userId, selectedUser?.userId, loadConversations]);

  // Auto-open chat from product page
  useEffect(() => {
    if (!targetUid || loading) return;
    const target = conversations.find(c => c.userId === targetUid);
    if (target) {
      selectConversation({ userId: target.userId, name: target.name });
    } else {
      api.get(`/users/${targetUid}`).then(({ data }) => {
        if (data?.id) selectConversation({ userId: data.id, name: data.name || 'Продавец' });
      }).catch(() => {});
    }
    // Clear uid from URL to prevent re-triggering
    navigate('/chat', { replace: true });
  }, [targetUid]);

  const ensureSharedKey = async (peerId: string): Promise<CryptoKey | null> => {
    const cached = sharedKeyCache.current.get(peerId);
    if (cached) return cached;
    try {
      const kp = await getOrCreateIdentityKey();
      const { data } = await api.get(`/chat/keys/${peerId}`);
      if (!data.publicKey) {
        toast.error('Собеседник ещё не активировал шифрование');
        return null;
      }
      const peerPub = await importPeerPublicKey(data.publicKey);
      const key = await deriveSharedKey(kp.privateKey, peerPub);
      sharedKeyCache.current.set(peerId, key);
      return key;
    } catch {
      toast.error('Не удалось получить ключ собеседника');
      return null;
    }
  };

  const hasStopWord = (text: string): boolean => {
    const lower = text.toLowerCase();
    return stopWords.some((word: string) => lower.includes(word.toLowerCase()));
  };

  const hasContact = (text: string): boolean => {
    const contactRegex =
      /(?:\+?\d{10,})|(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(?:https?:\/\/\S+)/gi;
    return contactRegex.test(text);
  };

  const decryptIncoming = async (msg: Message): Promise<Message> => {
    if (!msg.ciphertext) {
      // legacy plaintext message
      return msg;
    }
    const peerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
    const key = await ensureSharedKey(peerId);
    if (!key) return { ...msg, text: '[Не удалось расшифровать]' };
    try {
      return { ...msg, text: await decryptMessage(msg.ciphertext, key) };
    } catch {
      return { ...msg, text: '[Ошибка расшифровки]' };
    }
  };

  const startNewChat = async () => {
    if (!newChatPhone.trim()) return;
    try {
      // Find user by phone
      const { data } = await api.get(`/users/search?phone=${encodeURIComponent(newChatPhone)}`);
      if (data?.id) {
        selectConversation({ userId: data.id, name: data.name || newChatPhone });
        setShowNewChat(false);
        setNewChatPhone('');
      } else {
        toast.error('Пользователь не найден');
      }
    } catch {
      toast.error('Ошибка поиска');
    }
  };

  const selectConversation = async (user: { userId: string; name: string }) => {
    setSelectedUser(user);
    try {
      const { data } = await api.get(`/chat/messages/${user.userId}?limit=50`);
      const msgs: Message[] = data.items || [];
      const decrypted = await Promise.all(msgs.map(decryptIncoming));
      setMessages(decrypted);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !selectedUser || !socket) return;

    const text = messageText.trim();

    // Клиентская модерация ДО шифрования
    if (hasStopWord(text) || (detectContacts && hasContact(text))) {
      toast.error('Сообщение содержит запрещённый контент');
      return;
    }

    const key = await ensureSharedKey(selectedUser.userId);
    if (!key) return;

    const ciphertext = await encryptMessage(text, key);
    socket.emit('sendMessage', {
      receiverId: selectedUser.userId,
      ciphertext,
    });
    setMessageText('');
  };

  const reportMessage = async (msg: Message) => {
    try {
      await api.post('/chat/report', { messageId: msg.id });
      toast.success('Жалоба отправлена');
    } catch {
      toast.error('Не удалось отправить жалобу');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !selectedUser) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/chat/upload', formData);
      socket.emit('sendMessage', {
        receiverId: selectedUser.userId,
        file: { url: data.url, name: data.name, type: data.type, size: data.size },
      });
    } catch { toast.error('Не удалось загрузить файл'); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const formatTime = (d?: string) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const isThisYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(isThisYear ? {} : { year: 'numeric' }) });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] bg-[#0a0a0f]">
      {/* Sidebar */}
      <div className={`${selectedUser ? 'hidden md:flex' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-white/[0.06] bg-[#111118] shrink-0`}>
        {/* Header */}
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-white">Сообщения</h1>
            <button
              onClick={() => setShowNewChat(!showNewChat)}
              className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/60 hover:text-white transition-all"
            >
              {showNewChat ? <X size={16} /> : <Plus size={16} />}
            </button>
          </div>

          {/* New chat panel */}
          {showNewChat && (
            <div className="mb-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
              <p className="text-xs text-white/40 mb-2">Новый диалог по номеру телефона</p>
              <div className="flex gap-2">
                <input
                  value={newChatPhone}
                  onChange={e => setNewChatPhone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && startNewChat()}
                  placeholder="+790****0000"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-indigo-500/40"
                />
                <button
                  onClick={startNewChat}
                  disabled={!newChatPhone.trim()}
                  className="px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 disabled:opacity-30 transition-all"
                >
                  <UserPlus size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-white placeholder:text-white/20 outline-none focus:border-indigo-500/30 transition-all"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map(c => (
            <button
              key={c.userId}
              onClick={() => selectConversation({ userId: c.userId, name: c.name })}
              className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-all text-left border-b border-white/[0.02] ${selectedUser?.userId === c.userId ? 'bg-indigo-500/10 border-l-[3px] border-l-indigo-500' : ''}`}
            >
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-base">
                  {(c.name || '?')[0].toUpperCase()}
                </div>
                {c.unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#111118]">{c.unread > 9 ? '9+' : c.unread}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-white text-sm font-semibold truncate">{c.name}</p>
                  <span className="text-white/25 text-[10px] shrink-0 ml-2">{formatTime(c.lastMessageTime)}</span>
                </div>
                <p className={`text-xs truncate mt-0.5 ${c.unread > 0 ? 'text-white font-medium' : 'text-white/35'}`}>
                  {c.lastMessage || 'Нет сообщений'}
                </p>
              </div>
            </button>
          ))}
          {filteredConversations.length === 0 && conversations.length === 0 && (
            <div className="text-center py-12">
              <p className="text-white/25 text-sm">Нет диалогов</p>
              <p className="text-white/15 text-xs mt-1">Нажмите + чтобы начать</p>
            </div>
          )}
          {filteredConversations.length === 0 && conversations.length > 0 && (
            <div className="text-center py-12">
              <p className="text-white/25 text-sm">Ничего не найдено</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      {selectedUser ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#111118] shrink-0">
            <button onClick={() => setSelectedUser(null)} className="md:hidden text-white/50 hover:text-white">
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {(selectedUser.name || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">{selectedUser.name}</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-white/[0.04] flex items-center justify-center">
                    <Send size={24} className="text-white/15" />
                  </div>
                  <p className="text-white/30 text-sm">Нет сообщений</p>
                  <p className="text-white/15 text-xs mt-1">Напишите первое сообщение</p>
                </div>
              </div>
            )}
            {messages.map((msg) => {
              const isMine = msg.senderId === userId;
              const time = formatTime(msg.createdAt);
              const isLegacy = !msg.ciphertext && !!msg.text;
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[72%] group`}>
                    {!isMine && (
                      <p className="text-[10px] text-white/30 ml-2 mb-0.5">{msg.sender?.name || 'Пользователь'}</p>
                    )}
                    {msg.text && (
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
                        isMine
                          ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-br-md shadow-lg shadow-indigo-500/10'
                          : 'bg-[#1e1e2a] text-white/90 rounded-bl-md'
                      }`}>
                        {msg.text}
                      </div>
                    )}
                    {isLegacy && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400/80 text-[10px] font-medium">
                        незашифрованное (история)
                      </span>
                    )}
                    {msg.fileUrl && (
                      <div className={`px-4 py-2.5 rounded-2xl ${isMine ? 'bg-indigo-500 text-white rounded-br-md' : 'bg-[#1e1e2a] text-white/90 rounded-bl-md'}`}>
                        {msg.fileType?.startsWith('image/') ? (
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                            <img src={msg.fileUrl} alt={msg.fileName || 'Image'} className="max-w-[220px] max-h-[220px] rounded-lg object-cover" loading="lazy" />
                            {msg.fileName && <p className="text-[10px] mt-1.5 opacity-70 truncate max-w-[200px]">{msg.fileName}</p>}
                          </a>
                        ) : (
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm hover:opacity-80 transition-opacity">
                            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 text-lg">
                              {msg.fileType?.includes('pdf') ? '📄' : msg.fileType?.includes('zip') ? '📦' : '📎'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate max-w-[180px]">{msg.fileName || 'Файл'}</p>
                              {msg.fileSize && <p className="text-[10px] opacity-60">{Math.round(msg.fileSize / 1024)} KB</p>}
                            </div>
                          </a>
                        )}
                      </div>
                    )}
                    <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      {!isMine && (
                        <button
                          onClick={() => reportMessage(msg)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-white/25 hover:text-red-400"
                          title="Пожаловаться"
                        >
                          <Flag size={11} />
                        </button>
                      )}
                      <p className="text-[10px] text-white/20">{time}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06] bg-[#111118] shrink-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-10 h-10 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-all shrink-0"
            >
              {uploading ? <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> : <Paperclip size={18} />}
            </button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.doc,.docx,.txt,.zip" />
            <input
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Сообщение..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-indigo-500/40 transition-all"
            />
            <button
              onClick={sendMessage}
              disabled={!messageText.trim()}
              className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-400 disabled:opacity-20 transition-all shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/[0.04] flex items-center justify-center">
              <MessageCircle size={32} className="text-white/15" />
            </div>
            <p className="text-white/25 text-sm">Выберите диалог</p>
            <p className="text-white/10 text-xs mt-1">или нажмите + чтобы создать новый</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Missing icon
function MessageCircle({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}