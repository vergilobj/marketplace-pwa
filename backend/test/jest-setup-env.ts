/**
 * L1-ФИКС (ДЕФЕКТ 1): ранняя загрузка backend/.env и печать предупреждения
 * о режиме БД ДО первого теста (setupFiles выполняется в каждом воркере).
 */
import { resolveTestDatabaseUrl } from '../src/common/prisma/test-db-env';

resolveTestDatabaseUrl();