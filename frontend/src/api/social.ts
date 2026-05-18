import api from './axios';

export const likePost = (postId: string) => api.post(`/social/${postId}/like`);
export const unlikePost = (postId: string) => api.delete(`/social/${postId}/like`);
export const getComments = (postId: string) => api.get(`/social/${postId}/comments`).then(r => r.data);
export const addComment = (postId: string, text: string) =>
  api.post(`/social/${postId}/comments`, { text }).then(r => r.data);