import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Очистка существующих данных (осторожно!)
  await prisma.transaction.deleteMany();
  await prisma.withdrawalRequest.deleteMany();
  await prisma.moderationLog.deleteMany();
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.post.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();

  // 1. Создание пользователей
  const passwordHash = await bcrypt.hash('password123', 10);
  const users: any[] = [];

  // Админ
  const admin = await prisma.user.create({
    data: {
      phone: '79000000000',
      name: 'Администратор',
      role: 'ADMIN',
      referralCode: 'ADMIN000',
      passwordHash: passwordHash,
      isApproved: true,
      bonusBalance: 1000,
    },
  });
  users.push(admin);
  console.log(`Created user: ${admin.name}`);

  // Продавцы
  const sellersData = [
    { phone: '79161112233', name: 'Мария Петрова' },
    { phone: '79261112233', name: 'Алексей Иванов' },
    { phone: '79361112233', name: 'Елена Смирнова' },
  ];
  for (const s of sellersData) {
    const seller = await prisma.user.create({
      data: {
        phone: s.phone,
        name: s.name,
        role: 'SELLER',
        referralCode: uuidv4().slice(0, 8),
        passwordHash: passwordHash,
        isApproved: true,
        bonusBalance: 500,
      },
    });
    users.push(seller);
    console.log(`Created seller: ${seller.name}`);
  }

  // Покупатели
  const buyersData = [
    { phone: '79461112233', name: 'Дмитрий Волков' },
    { phone: '79561112233', name: 'Анна Кузнецова' },
    { phone: '79661112233', name: 'Сергей Попов' },
    { phone: '79761112233', name: 'Ольга Морозова' },
    { phone: '79861112233', name: 'Иван Соколов' },
    { phone: '79961112233', name: 'Татьяна Лебедева' },
  ];
  for (const b of buyersData) {
    const buyer = await prisma.user.create({
      data: {
        phone: b.phone,
        name: b.name,
        role: 'BUYER',
        referralCode: uuidv4().slice(0, 8),
        passwordHash: passwordHash,
        isApproved: true,
        bonusBalance: 100,
        invitedById: admin.id, // все приглашены админом для теста рефералов
      },
    });
    users.push(buyer);
    console.log(`Created buyer: ${buyer.name}`);
  }

  // 2. Создание товаров
  const productsData = [
    { title: 'Смартфон Galaxy S25', description: 'Флагманский смартфон с AMOLED-дисплеем 6.8", камерой 200 МП и батареей 5000 мАч.', price: 89990, seller: sellersData[0].phone },
    { title: 'Ноутбук ThinkPad X1', description: 'Ультрабук для бизнеса: 14" IPS, Intel Core i7-1365U, 16 ГБ ОЗУ, 512 ГБ SSD.', price: 124990, seller: sellersData[1].phone },
    { title: 'Беспроводные наушники AirBeats Pro', description: 'Шумоподавление, 36 часов работы, влагозащита IPX5, чехол с MagSafe.', price: 15990, seller: sellersData[2].phone },
    { title: 'Кроссовки Nike Air Max', description: 'Культовая модель с видимой воздушной подушкой, верх из сетки и замши.', price: 12990, seller: sellersData[0].phone },
    { title: 'Кофемашина DeLonghi Magnifica', description: 'Автоматическая кофемашина с капучинатором, 13 степеней помола, 15 бар давления.', price: 45990, seller: sellersData[1].phone },
    { title: 'Смарт-часы Watch 9 Pro', description: 'Always-On Retina, датчик кислорода, ECG, водозащита 50 м, 45 мм корпус.', price: 34990, seller: sellersData[2].phone },
    { title: 'Рюкзак городской CityPack 28L', description: 'Вместительный рюкзак с USB-портом, отделением для ноутбука, водонепроницаемый.', price: 4990, seller: sellersData[0].phone },
    { title: 'Офисное кресло ErgoChair Pro', description: 'Эргономичное кресло с поясничной поддержкой, сетчатой спинкой и 4D-подлокотниками.', price: 29990, seller: sellersData[1].phone },
    { title: 'Планшет iPad Pro M3', description: '11" Liquid Retina XDR, чип M3, 256 ГБ, поддержка Apple Pencil Pro.', price: 79990, seller: sellersData[2].phone },
    { title: 'Фитнес-браслет Band 8', description: 'AMOLED 1.62", SpO2, 150 режимов тренировок, 14 дней без подзарядки.', price: 3990, seller: sellersData[0].phone },
  ];

  for (const p of productsData) {
    const seller = users.find(u => u.phone === p.seller);
    const productImage = `https://picsum.photos/seed/${encodeURIComponent(p.title)}/600/400`;
    await prisma.product.create({
      data: {
        title: p.title,
        description: p.description,
        price: p.price,
        media: [productImage],
        sellerId: seller.id,
        isActive: true,
      },
    });
    console.log(`Created product: ${p.title}`);
  }

  // 3. Создание постов
  const postsData = [
    { title: 'Запуск маркетплейса!', content: 'Друзья, мы рады сообщить о запуске нашего закрытого маркетплейса! Здесь вы найдёте лучшие товары от проверенных продавцов. Приглашайте друзей и получайте бонусы!', authorPhone: '79000000000' },
    { title: 'Как выбрать идеальные кроссовки', content: 'В нашем новом обзоре рассказываем о главных критериях выбора кроссовок для бега, повседневной носки и тренировок.', authorPhone: '79000000000' },
    { title: 'Специальное предложение на TechWeek', content: 'Только до конца недели скидки до 30% на всю электронику! Успейте заказать новый смартфон или ноутбук по выгодной цене.', authorPhone: '79000000000' },
    { title: 'Реферальная программа', content: 'Приглашайте друзей в наш маркетплейс и получайте 5% от каждой их покупки! Ваш реферальный код доступен в профиле.', authorPhone: '79000000000' },
    { title: 'Советы по обустройству домашнего офиса', content: 'Правильное кресло и организация рабочего места — залог продуктивности. В этом посте делимся рекомендациями по выбору мебели для удалённой работы.', authorPhone: '79000000000' },
  ];

  for (const po of postsData) {
    const author = users.find(u => u.phone === po.authorPhone);
    await prisma.post.create({
      data: {
        title: po.title,
        content: po.content,
        authorId: author.id,
        isAd: false,
        isHidden: false,
      },
    });
    console.log(`Created post: ${po.title}`);
  }

  // 4. Создание пары заказов для истории
  const allProducts = await prisma.product.findMany();
  const buyers = users.filter(u => u.role === 'BUYER');
  if (allProducts.length > 0 && buyers.length > 0) {
    for (let i = 0; i < 5; i++) {
      const buyer = buyers[i % buyers.length];
      const product = allProducts[i % allProducts.length];
      const order = await prisma.order.create({
        data: {
          buyerId: buyer.id,
          sellerId: product.sellerId,
          productId: product.id,
          amount: product.price,
          status: 'PAID',
          referralUserId: admin.id,
          referralBonus: (product.price * 5) / 100,
          platformFee: (product.price * 10) / 100,
          paidAt: new Date(),
        },
      });
      console.log(`Created order for ${buyer.name}: ${product.title}`);
    }
  }

  console.log('Seeding complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });