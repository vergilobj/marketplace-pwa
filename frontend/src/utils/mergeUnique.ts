/**
 * Идемпотентное слияние страниц пагинации.
 *
 * Бэкенд отдаёт страницы через OFFSET без уникального tiebreaker'а в ORDER BY,
 * а createdAt у массово засеянных записей совпадает — поэтому соседние
 * страницы могут пересекаться, и в конец списка попадали уже показанные
 * записи. Для React это дублирующиеся key, для пользователя — задвоенная
 * лента. Здесь такие повторы отбрасываются по id.
 *
 * Первое вхождение выигрывает: свежая версия записи из prev сохраняется
 * (в ней уже проставлены likedByMe/likeCount после оптимистичных апдейтов).
 */
export function mergeUniqueById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((x) => x.id));
  const fresh = next.filter((x) => x && !seen.has(x.id));
  return fresh.length === 0 ? prev : [...prev, ...fresh];
}

export default mergeUniqueById;