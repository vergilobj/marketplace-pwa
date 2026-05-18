import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Send } from 'lucide-react';

// Типы для бесед и сообщений
interface Conversation {
  conversationId: string;
  conversationWith: { uid: string; name: string };
  lastMessage: { text: string };
  unreadMessageCount: number;
}

interface Message {
  id: string;
  sender: { uid: string; name: string };
  text: string;
  sentAt: number;
}

export default function ChatPage() {
  const [searchParams] = useSearchParams();
  const uidFromUrl = searchParams.get('uid');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(uidFromUrl || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Загрузка бесед
  useEffect(() => {
    const limit = 30;
    const conversationsRequest = new CometChat.ConversationsRequestBuilder()
      .setLimit(limit)
      .build();

    conversationsRequest.fetchNext().then(
      (convList: any[]) => {
        setConversations(convList.map((conv: any) => ({
          conversationId: conv.getConversationId(),
          conversationWith: {
            uid: conv.getConversationWith().getUid(),
            name: conv.getConversationWith().getName(),
          },
          lastMessage: {
            text: conv.getLastMessage()?.getText?.() || '',
          },
          unreadMessageCount: conv.getUnreadMessageCount(),
        })));
      },
      error => console.error('Failed to load conversations', error)
    );
  }, []);

  // Загрузка сообщений при выборе пользователя
  useEffect(() => {
    if (!selectedUser) return;
    const messagesRequest = new CometChat.MessagesRequestBuilder()
      .setUID(selectedUser)
      .setLimit(50)
      .build();

    messagesRequest.fetchPrevious().then(
      (msgs: any[]) => {
        setMessages(msgs.map((msg: any) => ({
          id: msg.getId(),
          sender: {
            uid: msg.getSender().getUid(),
            name: msg.getSender().getName(),
          },
          text: msg.getText(),
          sentAt: msg.getSentAt(),
        })));
        scrollToBottom();
      },
      error => console.error('Failed to load messages', error)
    );

    // Слушатель новых сообщений
    const listenerId = `chat_${selectedUser}`;
    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onTextMessageReceived: (textMessage: any) => {
          if (textMessage.getSender().getUid() === selectedUser) {
            setMessages(prev => [...prev, {
              id: textMessage.getId(),
              sender: {
                uid: textMessage.getSender().getUid(),
                name: textMessage.getSender().getName(),
              },
              text: textMessage.getText(),
              sentAt: textMessage.getSentAt(),
            }]);
            scrollToBottom();
          }
        },
      })
    );

    return () => {
      CometChat.removeMessageListener(listenerId);
    };
  }, [selectedUser]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedUser) return;
    const textMessage = new CometChat.TextMessage(
      selectedUser,
      newMessage.trim(),
      CometChat.RECEIVER_TYPE.USER
    );
    try {
      const sentMessage = await CometChat.sendMessage(textMessage);
      setMessages(prev => [...prev, {
        id: sentMessage.getId(),
        sender: {
          uid: sentMessage.getSender().getUid(),
          name: sentMessage.getSender().getName(),
        },
        text: sentMessage.getText(),
        sentAt: sentMessage.getSentAt(),
      }]);
      setNewMessage('');
      scrollToBottom();
    } catch (error) {
      console.error('Send message failed', error);
    }
  };

  const userId = localStorage.getItem('userId');

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Чат</h1>
      <Card className="p-0 overflow-hidden">
        <div className="flex h-[75vh]">
          {/* Список бесед */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            {conversations.map(conv => (
              <div
                key={conv.conversationId}
                onClick={() => setSelectedUser(conv.conversationWith.uid)}
                className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition ${
                  selectedUser === conv.conversationWith.uid ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
                    {conv.conversationWith.name?.[0] || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{conv.conversationWith.name}</p>
                    <p className="text-sm text-gray-500 truncate">{conv.lastMessage.text}</p>
                  </div>
                </div>
              </div>
            ))}
            {conversations.length === 0 && (
              <div className="p-4 text-center text-gray-500">
                Нет диалогов
              </div>
            )}
          </div>

          {/* Сообщения */}
          <div className="w-2/3 flex flex-col">
            {selectedUser ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map(msg => {
                    const isMine = msg.sender.uid === userId;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[70%] p-3 rounded-2xl ${
                            isMine
                              ? 'bg-blue-600 text-white rounded-br-md'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-md'
                          }`}
                        >
                          <p className="text-sm">{msg.text}</p>
                          <p className="text-xs mt-1 opacity-70">
                            {new Date(msg.sentAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendMessage();
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Введите сообщение..."
                      className="flex-1"
                    />
                    <Button type="submit" variant="primary" size="sm">
                      <Send size={16} />
                    </Button>
                  </form>
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