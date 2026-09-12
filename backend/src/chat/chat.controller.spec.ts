/**
 * DEPRECATED — REST-эндпоинты p2p-чата отключены (Э4-backend).
 * Контроллер больше не регистрируется в ChatModule, файл оставлен как
 * историческая справка, поэтому и спека к нему устарела: класс пуст, а
 * тест ждал рабочего setPublicKey.
 *
 * Заменено заглушкой: проверяем, что модуль/класс вообще импортируется,
 * без обращения к несуществующим методам. Полный тест чата — по сервису
 * (chat.service.spec.ts).
 */
import { ChatController } from './chat.controller';

describe('ChatController (deprecated)', () => {
  it('класс-заглушка существует (REST /chat/* отключён)', () => {
    expect(ChatController).toBeDefined();
  });
});
