/**
 * R14: единая проверка активного пункта меню.
 * Точное совпадение для корня, startsWith для вложенных путей
 * (`/products/123` подсвечивает «Каталог», `/bazar?...` — «Базар»).
 * Ровно один активный пункт гарантирован тем, что все href в меню
 * не являются префиксами друг друга.
 *
 * Вынесено из Layout.tsx: файл компонента должен экспортировать только
 * компоненты, иначе ломается Fast Refresh (react-refresh/only-export-components).
 */
export function isNavActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}