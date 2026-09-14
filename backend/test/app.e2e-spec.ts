import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

import request from 'supertest';

describe('App E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Endpoints', () => {
    // L1 (2026-09-12): списки отдают пагинированный конверт
    // { items, total, page, pages }, а не голый массив. Тесты обновлены
    // под текущий контракт (были написаны до введения пагинации).
    it('GET /products returns paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/products')
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('GET /posts returns paginated envelope', async () => {
      const res = await request(app.getHttpServer()).get('/posts').expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('GET /posts/feed returns paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/posts/feed')
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('GET /products/:id 404 for missing', async () => {
      await request(app.getHttpServer())
        .get('/products/nonexistent-id-12345')
        .expect(404);
    });

    it('GET /posts/:id 404 for missing', async () => {
      await request(app.getHttpServer())
        .get('/posts/nonexistent-id-12345')
        .expect(404);
    });

    it('GET /social/:postId/likes returns array', async () => {
      const res = await request(app.getHttpServer())
        .get('/social/fake-post/likes')
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /social/:postId/comments returns array', async () => {
      const res = await request(app.getHttpServer())
        .get('/social/fake-post/comments')
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Auth', () => {
    it('POST /auth/login bad creds returns 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ phone: '+0000000000', password: 'wrong' })
        .expect(401);
    });

    it('POST /auth/register bad invite returns 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          phone: '+0000000000',
          name: 'Test',
          password: 'pass123',
          inviteCode: 'INVALID',
        })
        .expect(400);
    });
  });

  describe('Protected Endpoints — no token', () => {
    it('GET /users/me returns 401', () =>
      request(app.getHttpServer()).get('/users/me').expect(401));
    it('GET /orders/my returns 401', () =>
      request(app.getHttpServer()).get('/orders/my').expect(401));
    it('GET /notifications returns 401', () =>
      request(app.getHttpServer()).get('/notifications').expect(401));
    it('GET /admin/dashboard returns 401', () =>
      request(app.getHttpServer()).get('/admin/dashboard').expect(401));
    it('POST /products returns 401', () =>
      request(app.getHttpServer())
        .post('/products')
        .send({ title: 'T', description: 'D', price: 100 })
        .expect(401));
    it('POST /orders returns 401', () =>
      request(app.getHttpServer())
        .post('/orders')
        .send({ productId: 'p1' })
        .expect(401));
    it('POST /social/:postId/like returns 401', () =>
      request(app.getHttpServer()).post('/social/post-1/like').expect(401));
    it('GET /payments/transactions returns 401', () =>
      request(app.getHttpServer()).get('/payments/transactions').expect(401));
    it('GET /invites returns 401', () =>
      request(app.getHttpServer()).get('/invites').expect(401));
    it('GET /settings returns 401', () =>
      request(app.getHttpServer()).get('/settings').expect(401));
    // p2p-чат отключён (ChatModule убран из AppModule), роут /chat/webhook
    // больше не существует → 404. Проверяем защиту актуального эндпоинта.
    it('GET /feedback/my returns 401', () =>
      request(app.getHttpServer()).get('/feedback/my').expect(401));
    it('POST /consult/ask returns 401', () =>
      request(app.getHttpServer())
        .post('/consult/ask')
        .send({ text: 'hi' })
        .expect(401));
  });
});
