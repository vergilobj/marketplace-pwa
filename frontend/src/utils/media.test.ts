import { describe, it, expect } from 'vitest';
import { resolveMedia, resolveMediaList } from './media';
import { buildGallery, isDirectVideoUrl } from './video';

// Баг, из-за которого «фото и видео ничего не работает»: бэкенд отдаёт
// абсолютный localhost-URL, на внешнем устройстве он указывает на само
// устройство. resolveMedia обязан срезать origin до относительного пути.
describe('resolveMedia', () => {
  it('localhost absolute url -> relative path', () => {
    expect(resolveMedia('http://localhost:3000/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(resolveMedia('http://127.0.0.1:3000/uploads/videos/b.mp4')).toBe('/uploads/videos/b.mp4');
  });

  it('prod origin -> relative path', () => {
    expect(resolveMedia('https://xn--80aabz0c.shop/uploads/c.png')).toBe('/uploads/c.png');
  });

  it('already relative -> untouched', () => {
    expect(resolveMedia('/uploads/d.jpg')).toBe('/uploads/d.jpg');
  });

  it('external cdn url -> untouched', () => {
    expect(resolveMedia('https://picsum.photos/seed/x/800/600')).toBe('https://picsum.photos/seed/x/800/600');
  });

  it('empty -> empty string', () => {
    expect(resolveMedia('')).toBe('');
    expect(resolveMedia(null)).toBe('');
    expect(resolveMedia(undefined)).toBe('');
    expect(resolveMedia('   ')).toBe('');
  });

  it('resolveMediaList drops empties', () => {
    expect(resolveMediaList(['http://localhost:3000/uploads/a.jpg', null, '', '/uploads/b.jpg']))
      .toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
    expect(resolveMediaList(null)).toEqual([]);
  });
});

describe('isDirectVideoUrl', () => {
  it('uploads video / extensions', () => {
    expect(isDirectVideoUrl('http://localhost:3000/uploads/videos/x.mov')).toBe(true);
    expect(isDirectVideoUrl('https://cdn.test/clip.webm?t=1')).toBe(true);
    expect(isDirectVideoUrl('https://youtu.be/abc123')).toBe(false);
  });
});

describe('buildGallery', () => {
  it('video first, photos after', () => {
    const g = buildGallery(['/uploads/a.jpg', '/uploads/b.jpg'], 'http://localhost:3000/uploads/videos/v.mp4');
    expect(g.map(s => s.type)).toEqual(['video', 'image', 'image']);
    expect(g[0].src).toBe('http://localhost:3000/uploads/videos/v.mp4');
    expect(g[1].src).toBe('/uploads/a.jpg');
  });

  it('no video -> photos only', () => {
    const g = buildGallery(['/uploads/a.jpg'], null);
    expect(g.map(s => s.type)).toEqual(['image']);
  });

  it('no media -> empty', () => {
    expect(buildGallery(undefined, null)).toEqual([]);
    expect(buildGallery([], '')).toEqual([]);
  });

  it('string media normalised to array', () => {
    expect(buildGallery('/uploads/a.jpg' as unknown as string[], null).map(s => s.src)).toEqual(['/uploads/a.jpg']);
  });

  it('embed host (youtube) goes to gallery as embed, first', () => {
    const g = buildGallery(['/uploads/a.jpg'], 'https://youtu.be/dQw4w9WgXcQ');
    expect(g[0].type).toBe('embed');
    expect(g[0].src).toContain('/embed/dQw4w9WgXcQ');
  });
});