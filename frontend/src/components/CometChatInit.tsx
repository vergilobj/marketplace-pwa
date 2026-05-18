import { useEffect, useState } from 'react';
import { CometChatUIKit, UIKitSettingsBuilder } from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';

const COMETCHAT_APP_ID = '1678891a18bba4749';
const COMETCHAT_REGION = 'us';
const COMETCHAT_AUTH_KEY = 'fdca52860f5a94590f8095c50743331726c12205';

export default function CometChatInit({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const settings = new UIKitSettingsBuilder()
      .setAppId(COMETCHAT_APP_ID)
      .setRegion(COMETCHAT_REGION)
      .setAuthKey(COMETCHAT_AUTH_KEY)
      .build();

    CometChatUIKit.init(settings)?.then(async () => {
      console.log('CometChat UI Kit initialized');
      const userId = localStorage.getItem('userId');
      if (userId) {
        try {
          // Если пользователь уже залогинен в CometChat, проверим
          const loggedInUser = await CometChat.getLoggedinUser();
          if (!loggedInUser || loggedInUser.getUid() !== userId) {
            await CometChat.login(userId, COMETCHAT_AUTH_KEY);
            console.log('CometChat logged in as', userId);
          }
        } catch (err) {
          // Если не залогинен, пробуем логин
          try {
            await CometChat.login(userId, COMETCHAT_AUTH_KEY);
            console.log('CometChat logged in as', userId);
          } catch (loginErr) {
            console.error('CometChat login failed', loginErr);
            // Если ошибка, что пользователь не найден, подождём создания на бэкенде и повторим
          }
        }
      }
      setIsReady(true);
    });
  }, []);

  if (!isReady) return <div className="text-center py-10 text-gray-500">Загрузка чата...</div>;
  return <>{children}</>;
}