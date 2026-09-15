import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { resolveMedia } from '../../utils/media';

interface MediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Сырой путь из API — нормализуется через resolveMedia внутри. */
  src?: string | null;
  /** Заглушка: и когда медиа нет, и когда файл не загрузился (404/битый). */
  fallback: ReactNode;
}

/**
 * B2 (WAVE 2, п.4): картинка с ЗАГЛУШКОЙ НА ОШИБКУ загрузки.
 *
 * Было: заглушка рисовалась только при ОТСУТСТВИИ медиа (`media[0]` пусто).
 * Если файл отдавал 404 или был битым, `<img>` показывал серый квадрат
 * браузера со сломанной иконкой — выглядело как баг вёрстки.
 *
 * Стало: `onError` переключает на ТУ ЖЕ заглушку, что и «медиа нет».
 *
 * Нормализация URL (`resolveMedia`) живёт внутри — вызывающий передаёт сырой
 * путь, как он пришёл из API.
 *
 * Сбой запоминается по КОНКРЕТНОМУ url: если проп `src` сменится (карточка
 * переиспользована под другой товар), картинка снова попробует загрузиться,
 * а не останется заглушкой навсегда.
 */
export default function MediaImage({ src, fallback, alt = '', ...rest }: MediaImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const url = resolveMedia(src);

  if (!url || url === failedSrc) return <>{fallback}</>;

  return <img {...rest} src={url} alt={alt} onError={() => setFailedSrc(url)} />;
}