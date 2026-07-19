import { Test, TestingModule } from '@nestjs/testing';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

describe('PostsController', () => {
  let controller: PostsController;
  let service: any;

  const mockService = {
    getFeed: jest.fn(),
    create: jest.fn(),
    createAd: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    delete: jest.fn(),
    findAllAdmin: jest.fn(),
    toggleVisibility: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [{ provide: PostsService, useValue: mockService }],
    }).compile();
    controller = module.get<PostsController>(PostsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('feed', () => {
    it('should return feed with userId', async () => {
      service.getFeed.mockResolvedValue([]);
      await controller.feed({ user: { userId: 'user-1' } });
      expect(service.getFeed).toHaveBeenCalledWith('user-1');
    });

    it('should return feed without user', async () => {
      service.getFeed.mockResolvedValue([]);
      await controller.feed({ user: undefined });
      expect(service.getFeed).toHaveBeenCalledWith(undefined);
    });
  });

  describe('create', () => {
    it('should create post', async () => {
      service.create.mockResolvedValue({ id: 'post-1' });
      const result = await controller.create(
        { user: { userId: 'admin-1' } },
        { title: 'T', content: 'C' },
      );
      expect(result.id).toBe('post-1');
    });
  });

  describe('createAd', () => {
    it('should create ad', async () => {
      service.createAd.mockResolvedValue({ id: 'ad-1', isAd: true });
      const result = await controller.createAd(
        { user: { userId: 'seller-1' } },
        { title: 'Ad', content: '', link: '', days: 7 },
      );
      expect(result.isAd).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return posts', async () => {
      service.findAll.mockResolvedValue([]);
      expect(await controller.findAll()).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return post', async () => {
      service.findById.mockResolvedValue({ id: 'post-1' });
      expect(await controller.findById('post-1')).toEqual({ id: 'post-1' });
    });
  });

  describe('delete', () => {
    it('should delete post', async () => {
      service.delete.mockResolvedValue({ id: 'post-1' });
      await controller.delete('post-1');
      expect(service.delete).toHaveBeenCalledWith('post-1');
    });
  });

  describe('findAllAdmin', () => {
    it('should return admin list', async () => {
      service.findAllAdmin.mockResolvedValue({ items: [], total: 0 });
      await controller.findAllAdmin('1', '10', '', 'visible');
      expect(service.findAllAdmin).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        status: 'visible',
      });
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle visibility', async () => {
      service.toggleVisibility.mockResolvedValue({
        id: 'post-1',
        isHidden: true,
      });
      const result = await controller.toggleVisibility('post-1');
      expect(result.isHidden).toBe(true);
    });
  });

  describe('update', () => {
    it('should update post', async () => {
      service.update.mockResolvedValue({ id: 'post-1', title: 'Edited' });
      const result = await controller.update(
        'post-1',
        { user: { userId: 'u1', role: 'ADMIN' } },
        { title: 'Edited' },
      );
      expect(result.title).toBe('Edited');
    });
  });
});
