import api from './axios';
import type { ApiComment } from './types';

export const likePost = (postId: string) => api.post(`/social/${postId}/like`);
export const unlikePost = (postId: string) => api.delete(`/social/${postId}/like`);

/**
 * L2: комментарии поста — страницей.
 *
 * Бэкенд (`GET /social/:postId/comments`) принимает page/limit и клампит limit
 * до 100, но отдаёт МАССИВ (без total/pages), поэтому признак «есть ещё» фронт
 * выводит из длины страницы, а точный счётчик берёт из `post.commentCount`.
 */
export const getComments = (postId: string, params?: { page?: number; limit?: number }) =>
  api.get<ApiComment[]>(`/social/${postId}/comments`, { params }).then(r => r.data);

export const addComment = (postId: string, text: string) =>
  api.post<ApiComment>(`/social/${postId}/comments`, { text }).then(r => r.data);

export const updateComment = (commentId: string, text: string) =>
  api.patch<ApiComment>(`/social/comments/${commentId}`, { text }).then(r => r.data);

export const deleteComment = (commentId: string) =>
  api.delete(`/social/comments/${commentId}`);