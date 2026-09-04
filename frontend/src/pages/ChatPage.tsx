import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Search, Send, ArrowLeft, Paperclip, Plus, X, UserPlus, Flag } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { getOrCreateIdentityKey, exportPublicKeyRaw, importPeerPublicKey, deriveSharedKey, encryptMessage, decryptMessage } from '../utils/crypto';

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
  const [onlineUsers, setOnlineUsers] = useState<Map<string, boolean>>(new Map());
  const [pendingFiles, setPendingFiles] = useState<Array<{ url: string; name: string; type: string; size: number; previewUrl?: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const identityKeyRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeysRef = useRef<Map<string, CryptoKey>>(new Map());

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.name.toLowerCase().includes(q));
  }, [searchQuery, conversations]);

  // Auth check
  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
  }, [userId]);

  // Register identity key with backend (best-effort, non-blocking)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const kp = await getOrCreateIdentityKey();
        identityKeyRef.current = kp;
        const publicKey = await exportPublicKeyRaw(kp.publicKey);
        await api.post('/chat/keys', { publicKey });
      } catch { /* plaintext fallback */ }
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

  const decryptDisplayMessage = useCallback(async (m: Message): Promise<Message> => {
    if (!m.ciphertext || m.text) return m;
    const partnerId = m.senderId === userId ? m.receiverId : m.senderId;
    const sharedKey = sharedKeysRef.current.get(partnerId);
    if (!sharedKey) return { ...m, text: '(сообщение зашифровано)' };
    try {
      const text = await decryptMessage(m.ciphertext, sharedKey);
      return { ...m, text };
    } catch {
      return { ...m, text: '(сообщение зашифровано)' };
    }
  }, [userId]);

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

    s.on('userStatus', ({ userId: uid, online }: { userId: string; online: boolean }) => {
      setOnlineUsers(prev => {
        const m = new Map(prev);
        m.set(uid, online);
        return m;
      });
    });

    s.on('newMessage', (msg: Message) => {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (selectedUser && selectedUser.userId === partnerId) {
        decryptDisplayMessage(msg).then(decrypted => {
          setMessages(prev => [...prev, decrypted]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        });
        s.emit('markRead', { senderId: msg.senderId });
      }
      loadConversations();
    });

    s.on('messageSent', (msg: Message) => {
      if (selectedUser && (msg.receiverId === selectedUser.userId || msg.senderId === selectedUser.userId)) {
        decryptDisplayMessage(msg).then(decrypted => {
          setMessages(prev => [...prev, decrypted]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        });
      }
      loadConversations();
    });

    loadConversations();
    return () => { s.disconnect(); };
  }, [userId, selectedUser?.userId, loadConversations, decryptDisplayMessage]);

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
      // Ensure peer shared key is cached
      if (identityKeyRef.current && !sharedKeysRef.current.has(user.userId)) {
        try {
          const { data } = await api.get(`/chat/keys/${user.userId}`);
          if (data?.publicKey) {
            const peerPublic = await importPeerPublicKey(data.publicKey);
            const sharedKey = await deriveSharedKey(identityKeyRef.current.privateKey, peerPublic);
            sharedKeysRef.current.set(user.userId, sharedKey);
          }
        } catch { /* plaintext fallback */ }
      }
      const { data } = await api.get(`/chat/messages/${user.userId}?limit=50`);
      const rawMessages: Message[] = data.items || [];
      const sharedKey = sharedKeysRef.current.get(user.userId);
      const msgs = await Promise.all(rawMessages.map(async (m) => {
        if (m.ciphertext && sharedKey && !m.text) {
          try {
            const text = await decryptMessage(m.ciphertext, sharedKey);
            return { ...m, text };
          } catch {
            return { ...m, text: '(сообщение зашифровано)' };
          }
        }
        return m;
      }));
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if ((!messageText.trim() && pendingFiles.length === 0) || !selectedUser || !socket) return;

    const text = messageText.trim();
    const file = pendingFiles[0];
    setMessageText('');
    setPendingFiles([]);

    let ciphertext: string | undefined;
    let finalText: string | undefined = text || undefined;
    const sharedKey = sharedKeysRef.current.get(selectedUser.userId);
    if (sharedKey && text) {
      try {
        ciphertext = await encryptMessage(text, sharedKey);
        finalText = undefined;
      } catch { /* fall back to plaintext */ }
    }

    socket.emit('sendMessage', {
      receiverId: selectedUser.userId,
      text: finalText,
      ciphertext,
      file,
    }, (res: { error?: string; reason?: string } | null) => {
      if (res?.error === 'moderated') {
        toast.error('Сообщение заблокировано модерацией' + (res.reason ? ': ' + res.reason : ''));
        setMessageText(text);
        if (file) setPendingFiles([file]);
      }
    });
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
    if (!file || !selectedUser) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/chat/upload', formData);
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setPendingFiles(prev => [...prev, {
        url: data.url,
        name: data.name,
        type: data.type,
        size: data.size,
        previewUrl,
      }]);
    } catch { toast.error('Не удалось загрузить файл'); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingFile = (url: string) => {
    setPendingFiles(prev => {
      const f = prev.find(x => x.url === url);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter(x => x.url !== url);
    });
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
    <div className="flex h-[calc(100vh-64px)] bg-[transparent]">
      {/* Sidebar */}
      <div className={`${selectedUser ? 'hidden md:flex' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-[rgba(255,255,255,0.07)] glass shrink-0 rounded-l-[26px]`}>
        {/* Header */}
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-white">Сообщения</h1>
            <button
              onClick={() => setShowNewChat(!showNewChat)}
              className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/60 hover:text-[var(--color-text)] transition-all"
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
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-[var(--color-text)] placeholder:text-white/20 outline-none focus:border-indigo-500/40"
                />
                <button
                  onClick={startNewChat}
                  disabled={!newChatPhone.trim()}
                  className="px-3 py-2 rounded-lg bg-indigo-500 text-[var(--color-text)] text-sm font-semibold hover:bg-indigo-400 disabled:opacity-30 transition-all"
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
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-[var(--color-text)] placeholder:text-white/20 outline-none focus:border-indigo-500/30 transition-all"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map(c => {
            const isOnline = onlineUsers.get(c.userId) === true;
            return (
              <button
                key={c.userId}
                onClick={() => selectConversation({ userId: c.userId, name: c.name })}
                className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-all text-left border-b border-white/[0.02] ${selectedUser?.userId === c.userId ? 'bg-indigo-500/10 border-l-[3px] border-l-indigo-500' : ''}`}
              >
                <div className="relative shrink-0">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[var(--color-text)] font-bold text-base">
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  {isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[var(--color-card)]" />
                  )}
                  {c.unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-indigo-500 text-[var(--color-text)] text-[10px] font-bold flex items-center justify-center border-2 border-[var(--color-card)]">{c.unread > 9 ? '9+' : c.unread}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-[var(--color-text)] text-sm font-semibold truncate">{c.name}</p>
                    <span className="text-white/25 text-[10px] shrink-0 ml-2">{formatTime(c.lastMessageTime)}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${c.unread > 0 ? 'text-[var(--color-text)] font-medium' : 'text-white/35'}`}>
                    {c.lastMessage || 'Нет сообщений'}
                  </p>
                </div>
              </button>
            );
          })}
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
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.07)] glass-strong shrink-0">
            <button onClick={() => setSelectedUser(null)} className="md:hidden text-white/50 hover:text-white">
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[var(--color-text)] font-bold text-sm shrink-0">
              {(selectedUser.name || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-text)] text-sm font-semibold truncate">{selectedUser.name}</p>
              <p className={`text-[11px] ${onlineUsers.get(selectedUser.userId) === true ? 'text-emerald-400' : 'text-white/30'}`}>
                {onlineUsers.get(selectedUser.userId) === true ? 'онлайн' : 'офлайн'}
              </p>
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
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[72%] group`}>
                    {!isMine && (
                      <p className="text-[10px] text-white/30 ml-2 mb-0.5">{msg.sender?.name || 'Пользователь'}</p>
                    )}
                    {msg.text && (
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words shadow-lg ${
                        isMine
                          ? 'text-[var(--color-text)] rounded-br-md shadow-[0_8px_20px_rgba(201,242,103,0.25)]'
                          : 'glass text-[var(--color-text)] rounded-bl-md'
                      }`} style={isMine ? { background: 'linear-gradient(135deg, #c9f267 0%, #8ee8ff 100%)' } : undefined}>
                        {msg.text}
                      </div>
                    )}
                    {msg.fileUrl && (
                      <div className={`px-4 py-2.5 rounded-2xl ${isMine ? 'text-[#0b0e0d] rounded-br-md' : 'glass text-[var(--color-text)] rounded-bl-md'}`} style={isMine ? { background: 'linear-gradient(135deg, #c9f267 0%, #8ee8ff 100%)' } : undefined}>
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
          <div className="border-t border-[rgba(255,255,255,0.07)] glass-strong shrink-0">
            {/* Pending attachments */}
            {pendingFiles.length > 0 && (
              <div className="flex items-center gap-2 px-4 pt-3 overflow-x-auto">
                {pendingFiles.map(f => (
                  <div key={f.url} className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/[0.06] border border-white/[0.1] group">
                    {f.previewUrl ? (
                      <img src={f.previewUrl} alt={f.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">
                        {f.type?.includes('pdf') ? '📄' : f.type?.includes('zip') ? '📦' : '📎'}
                      </div>
                    )}
                    <button
                      onClick={() => removePendingFile(f.url)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-[var(--color-text)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-all shrink-0"
              >
                {uploading ? <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> : <Paperclip size={18} />}
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.doc,.docx,.txt,.zip" />
              <input
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Сообщение..."
                className="flex-1 px-4 py-2.5 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)] outline-none focus:border-[rgba(201,242,103,0.5)] transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={!messageText.trim() && pendingFiles.length === 0}
                className="w-10 h-10 rounded-full text-[#0b0e0d] flex items-center justify-center disabled:opacity-20 transition-all shrink-0 shadow-[0_6px_20px_rgba(201,242,103,0.3)]"
                style={{ background: 'linear-gradient(135deg, #c9f267 0%, #8ee8ff 50%, #8ee8ff 100%)' }}
              >
                <Send size={16} />
              </button>
            </div>
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