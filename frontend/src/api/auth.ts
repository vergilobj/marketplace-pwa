import api from './axios';

export async function register(phone: string, name: string, password: string, inviteCode: string) {
  const { data } = await api.post('/auth/register', { phone, name, password, inviteCode });
  return data;
}

export async function login(phone: string, password: string) {
  const { data } = await api.post('/auth/login', { phone, password });
  return data;
}