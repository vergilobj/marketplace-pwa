import { useEffect, useState } from 'react';
import { CometChatUIKit, UIKitSettingsBuilder } from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';

const COMETCHAT_APP_ID = import.meta.env.VITE_COMETCHAT_APP_ID || '1678891a18bba4749';
const COMETCHAT_REGION = import.meta.env.VITE_COMETCHAT_REGION || 'us';
const COMETCHAT_AUTH_KEY = import.meta.env.VITE_COMETCHAT_AUTH_KEY || 'fdca52860f5a94590f8095c50743331726c12205';

export default function CometChatInit({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

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
          const loggedInUser = await CometChat.getLoggedinUser();
          if (!loggedInUser || loggedInUser.getUid() !== userId) {
            await CometChat.login(userId, COMETCHAT_AUTH_KEY);
            console.log('CometChat logged in as', userId);
          }
        } catch (_err) {
          try {
            await CometChat.login(userId, COMETCHAT_AUTH_KEY);
            console.log('CometChat logged in as', userId);
          } catch (loginErr) {
            console.error('CometChat login failed', loginErr);
          }
        }
      }
      setIsReady(true);
    }).catch((err) => {
      console.error('CometChat init failed', err);
      setIsReady(true); // Continue without chat
    });

    // Safety timeout: don't block UI forever if CometChat hangs
    timeout = setTimeout(() => {
      console.warn('CometChat init timeout — continuing without chat');
      setIsReady(true);
    }, 7000);

    return () => clearTimeout(timeout);
  }, []);

  if (!isReady) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-white/50 text-sm">Загрузка...</p>
      </div>
    </div>
  );
  return <>{children}</>;
}
