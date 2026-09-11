import BazarChat from '../components/bazar/BazarChat';

export default function BazarChatPage() {
  return (
    <div className="h-[calc(100dvh-228px)] md:h-[calc(100vh-156px)] flex flex-col overflow-hidden">
      {/* R18: заголовок страницы для скринридеров и SEO */}
      <h1 className="sr-only">Базар</h1>
      <div className="max-w-5xl lg:max-w-6xl w-full mx-auto px-4 py-6 flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 rounded-3xl flex flex-col overflow-hidden"
          style={{ background: '#0b0e0d', border: '1px solid rgba(34,197,94,0.12)' }}
        >
          {/* Чат */}
          <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6">
            <BazarChat />
          </div>
        </div>
      </div>
    </div>
  );
}