import api from './axios';
import type { ApiComment } from './types';

export const likePost = (postId: string) => api.post(`/social/${postId}/like`);
export const unlikePost = (postId: string) => api.delete(`/social/${postId}/like`);

export const getComments = (postId: string) =>
  api.get<ApiComment[]>(`/social/${postId}/comments`).then(r => r.data);

export const addComment = (postId: string, text: string) =>
  api.post<ApiComment>(`/social/${postId}/comments`, { text }).then(r => r.data);

export const updateComment = (commentId: string, text: string) =>
  api.patch<ApiComment>(`/social/comments/${commentId}`, { text }).then(r => r.data);

export const deleteComment = (commentId: string) =>
  api.delete(`/social/comments/${commentId}`);