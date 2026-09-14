import api from './axios';

/**
 * API ИИ-консультанта (ЭТАП 4 ТЗ §5.5, эндпоинты №13–16).
 *
 * Контракты 1:1 с `backend/src/consult/dto/consult.dto.ts` (класс `ConsultAnswer`)
 * — поля не выдуманы, сверены с работающим контроллером.
 */

/** Источники ответа (§5.2 ШАГ 6). */
export type ConsultSource = 'KNOWLEDGE' | 'CATALOG' | 'LLM' | 'FALLBACK';

/** Ответ POST /consult/ask. */
export interface ConsultAnswer {
  answer: string;
  source: ConsultSource | string;
  confidence: number;
  knowledgeId?: string;
  feedbackId?: string;
  askAdmin: boolean;
  suggestions: string[];
  /** id записи ConsultLog — нужен для POST /consult/:logId/rate. */
  logId?: string;
}

/** Строка истории (GET /consult/history отдаёт ConsultLog). */
export interface ConsultHistoryItem {
  id: string;
  userId?: string;
  question: string;
  answer: string;
  source: string;
  knowledgeId?: string | null;
  similarity?: number | null;
  helpful?: boolean | null;
  feedbackId?: string | null;
  createdAt: string;
}

export interface ConsultHistory {
  items: ConsultHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

/** Задать вопрос консультанту (§5.5 №13). */
export const consultAsk = (payload: {
  text: string;
  productId?: string;
  route?: string;
}) => api.post<ConsultAnswer>('/consult/ask', payload).then((r) => r.data);

/** Своя история вопросов (§5.5 №14). */
export const consultHistory = (page = 1, limit = 50) =>
  api
    .get<ConsultHistory>('/consult/history', { params: { page, limit } })
    .then((r) => r.data);

/** Оценить ответ 👍/👎 (§5.5 №15). */
export const consultRate = (logId: string, helpful: boolean) =>
  api.post(`/consult/${logId}/rate`, { helpful }).then((r) => r.data);

/** Позвать админа (§5.5 №16). */
export const consultCallAdmin = (payload: { text?: string; feedbackId?: string }) =>
  api
    .post<{ feedbackId: string; created: boolean; message: string | null }>(
      '/consult/call-admin',
      payload,
    )
    .then((r) => r.data);