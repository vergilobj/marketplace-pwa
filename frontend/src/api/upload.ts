import api from './axios';

export const uploadImage = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ url: string }>('/upload', formData);
  return data.url;
};

export const uploadVideo = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ url: string }>('/upload/video', formData);
  return data.url;
};

export const isInternalVideo = (url?: string | null): boolean => {
  if (!url) return false;
  return /\/uploads\/videos\//i.test(url);
};