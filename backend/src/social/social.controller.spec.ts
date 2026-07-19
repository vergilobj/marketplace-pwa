import { Test, TestingModule } from '@nestjs/testing';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

describe('SocialController', () => {
  let controller: SocialController;
  let service: any;

  const mockService = {
    likePost: jest.fn(),
    unlikePost: jest.fn(),
    getLikes: jest.fn(),
    addComment: jest.fn(),
    getComments: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: mockService }],
    }).compile();
    controller = module.get<SocialController>(SocialController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('like', () => {
    it('should like post', async () => {
      service.likePost.mockResolvedValue({ liked: true });
      const result = await controller.like(
        { user: { userId: 'u1' } },
        'post-1',
      );
      expect(result.liked).toBe(true);
      expect(service.likePost).toHaveBeenCalledWith('u1', 'post-1');
    });
  });

  describe('unlike', () => {
    it('should unlike post', async () => {
      service.unlikePost.mockResolvedValue({ liked: false });
      const result = await controller.unlike(
        { user: { userId: 'u1' } },
        'post-1',
      );
      expect(result.liked).toBe(false);
    });
  });

  describe('getLikes', () => {
    it('should return likes', async () => {
      service.getLikes.mockResolvedValue([]);
      expect(await controller.getLikes('post-1')).toEqual([]);
    });
  });

  describe('addComment', () => {
    it('should add comment', async () => {
      service.addComment.mockResolvedValue({ id: 'c1', text: 'Nice!' });
      const result = await controller.addComment(
        { user: { userId: 'u1' } },
        'post-1',
        'Nice!',
      );
      expect(result.text).toBe('Nice!');
    });
  });

  describe('getComments', () => {
    it('should return comments', async () => {
      service.getComments.mockResolvedValue([]);
      expect(await controller.getComments('post-1')).toEqual([]);
    });
  });

  describe('updateComment', () => {
    it('should update comment', async () => {
      service.updateComment.mockResolvedValue({ id: 'c1', text: 'Updated' });
      const result = await controller.updateComment(
        { user: { userId: 'u1', role: 'BUYER' } },
        'c1',
        'Updated',
      );
      expect(result.text).toBe('Updated');
    });
  });

  describe('deleteComment', () => {
    it('should delete comment', async () => {
      service.deleteComment.mockResolvedValue({ deleted: true });
      const result = await controller.deleteComment(
        { user: { userId: 'u1', role: 'BUYER' } },
        'c1',
      );
      expect(result.deleted).toBe(true);
    });
  });
});
