import { describe, it, expect } from 'vitest';
import { getVideoEmbed } from './video';

describe('getVideoEmbed', () => {
  it('internal uploads -> video', () => {
    const r = getVideoEmbed('https://xn--80aabz0c.shop/uploads/videos/abc.mp4');
    expect(r?.type).toBe('video');
  });

  it('youtube watch -> iframe embed', () => {
    const r = getVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(r).toEqual({ type: 'iframe', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', label: 'YouTube' });
  });

  it('youtu.be -> iframe embed', () => {
    const r = getVideoEmbed('https://youtu.be/dQw4w9WgXcQ');
    expect(r?.type).toBe('iframe');
    expect(r?.src).toContain('/embed/dQw4w9WgXcQ');
  });

  it('youtube shorts -> iframe embed', () => {
    const r = getVideoEmbed('https://youtube.com/shorts/abc123XYZ');
    expect(r?.type).toBe('iframe');
    expect(r?.src).toContain('/embed/abc123XYZ');
  });

  it('rutube -> iframe embed', () => {
    const r = getVideoEmbed('https://rutube.ru/video/abc123def/');
    expect(r).toEqual({ type: 'iframe', src: 'https://rutube.ru/play/embed/abc123def', label: 'RuTube' });
  });

  it('vk.com/video -> iframe embed', () => {
    const r = getVideoEmbed('https://vk.com/video-123_456');
    expect(r?.type).toBe('iframe');
    expect(r?.src).toContain('oid=-123');
    expect(r?.src).toContain('id=456');
  });

  it('vkvideo.ru -> iframe embed', () => {
    const r = getVideoEmbed('https://vkvideo.ru/video-123_456');
    expect(r?.type).toBe('iframe');
  });

  it('yandex disk -> link', () => {
    const r = getVideoEmbed('https://disk.yandex.ru/i/abcdef');
    expect(r).toEqual({ type: 'link', src: 'https://disk.yandex.ru/i/abcdef', label: 'Яндекс.Диск' });
  });

  it('google drive -> link', () => {
    const r = getVideoEmbed('https://drive.google.com/file/d/abc/view');
    expect(r?.type).toBe('link');
    expect(r?.label).toBe('Google Диск');
  });

  it('telegram -> link', () => {
    const r = getVideoEmbed('https://t.me/somechannel/123');
    expect(r).toEqual({ type: 'link', src: 'https://t.me/somechannel/123', label: 'Telegram' });
  });

  it('empty -> null', () => {
    expect(getVideoEmbed('')).toBeNull();
    expect(getVideoEmbed(null)).toBeNull();
    expect(getVideoEmbed(undefined)).toBeNull();
  });
});