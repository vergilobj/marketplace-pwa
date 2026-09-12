/**
 * B1 — просроченная реклама: авто-снятие `isPinned` (интеграционный тест на
 * РЕАЛЬНОЙ БД).
 *
 * Дыра: реклама держится в топе флагом `isPinned`, а срок — `adExpireDate`.
 * Когда срок истекает, `publicAdVisibility` рекламу из ленты убирает, но флаг
 * `isPinned` остаётся `true` — мёртвый флаг. `deactivateExpiredAds` приводит
 * флаг в соответствие сроку.
 *
 * Почему реальная БД: проверяем именно SQL-семантику `updateMany` по
 * `adExpireDate < now` (в т.ч. что `adExpireDate = null` НЕ попадает под
 * фильтр) и что активная реклама не задевается. На моках это не проверить.
 */
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostsService } from './posts.service';

describe('B1: авто-снятие isPinned с просроченной рекламы (integration)', () => {
  const prisma = new PrismaService();

  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const posts = new PostsService(
    prisma,
    new AuditService(prisma),
    new SettingsService(prisma),
    { createPaymentForOrder: jest.fn() } as any,
    notify,
    { moderate: jest.fn().mockResolvedValue({ verdict: 'allow' }) } as any,
  );

  const suffix = `b1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  const DAY_MS = 24 * 60 * 60 * 1000;

  const mkPost = async (opts: {
    isAd: boolean;
    isPinned: boolean;
    expireAt: Date | null;
    pinnedTitle: string;
  }) => {
    const user = await prisma.user.create({
      data: {
        phone: `${suffix}-${opts.pinnedTitle}`,
        name: `B1 ${opts.pinnedTitle}`,
        role: 'SELLER',
        referralCode: `${suffix}-${opts.pinnedTitle}`,
      },
    });
    createdUserIds.push(user.id);

    const post = await prisma.post.create({
      data: {
        title: opts.pinnedTitle,
        content: 'B1 integration',
        authorId: user.id,
        isAd: opts.isAd,
        adOwnerId: opts.isAd ? user.id : null,
        isPinned: opts.isPinned,
        adExpireDate: opts.expireAt,
      },
    });
    createdPostIds.push(post.id);
    return post;
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Только свои данные — снимаем флаги и удаляем созданное.
    await prisma.post.updateMany({
      where: { id: { in: createdPostIds } },
      data: { isPinned: false },
    });
    await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('снимает isPinned с просроченной рекламы, активную и обычные посты не трогает', async () => {
    const expired = await mkPost({
      isAd: true,
      isPinned: true,
      expireAt: new Date(Date.now() - 30 * DAY_MS),
      pinnedTitle: 'expired-ad',
    });
    const active = await mkPost({
      isAd: true,
      isPinned: true,
      expireAt: new Date(Date.now() + 30 * DAY_MS),
      pinnedTitle: 'active-ad',
    });
    // Реклама без даты окончания (orderId=null, проставлена в обход оплаты) —
    // под фильтр `adExpireDate < now` не подпадает, метод её не трогает.
    const noDate = await mkPost({
      isAd: true,
      isPinned: true,
      expireAt: null,
      pinnedTitle: 'no-expire-ad',
    });
    // Обычный пост: isAd=false — не наша забота, даже если просрочен «по дате».
    const plain = await mkPost({
      isAd: false,
      isPinned: true,
      expireAt: new Date(Date.now() - 30 * DAY_MS),
      pinnedTitle: 'plain-post',
    });

    const count = await posts.deactivateExpiredAds();

    // Среди наших постов просроченная реклама ровно одна (в БД могут быть
    // другие — поэтому проверяем свои id, а не абсолютное число).
    expect(count).toBeGreaterThanOrEqual(1);

    const reload = async (id: string) =>
      (await prisma.post.findUnique({
        where: { id },
        select: { isPinned: true, isHidden: true },
      }))!;

    expect((await reload(expired.id)).isPinned).toBe(false);
    expect((await reload(active.id)).isPinned).toBe(true);
    expect((await reload(noDate.id)).isPinned).toBe(true);
    expect((await reload(plain.id)).isPinned).toBe(true);

    // Пост не удалён и не скрыт — только снят из топа.
    const stillThere = await prisma.post.findUnique({
      where: { id: expired.id },
      select: { id: true, isHidden: true },
    });
    expect(stillThere?.id).toBe(expired.id);
    expect(stillThere?.isHidden).toBe(false);
  });

  it('идемпотентен: повторный вызов не находит просроченных', async () => {
    const expired = await mkPost({
      isAd: true,
      isPinned: true,
      expireAt: new Date(Date.now() - DAY_MS),
      pinnedTitle: 'expired-idem',
    });

    await expect(posts.deactivateExpiredAds()).resolves.toBeGreaterThanOrEqual(
      1,
    );
    const second = await posts.deactivateExpiredAds();
    expect(second).toBe(0);

    const row = await prisma.post.findUnique({
      where: { id: expired.id },
      select: { isPinned: true },
    });
    expect(row?.isPinned).toBe(false);
  });
});
