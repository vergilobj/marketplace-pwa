/**
 * Общие типы данных API.
 *
 * Источник истины — `backend/prisma/schema.prisma`. Здесь описаны те поля,
 * которые реально приходят на фронт (включая вычисляемые бэкендом агрегаты:
 * likeCount / likedByMe / commentCount и т.п.).
 *
 * Правило проекта: не выдумывать поля. Если поля нет в схеме и оно не
 * подтверждено кодом страницы — его здесь быть не должно.
 */

/** Базовый пользователь — соответствует модели User (без приватных полей). */
export interface ApiUser {
  id: string;
  phone: string;
  name?: string | null;
  role: UserRole;
  avatar?: string | null;
  referralCode?: string;
  bonusBalance?: number;
  availableBalance?: number;
  isApproved?: boolean;
  trustScore?: number;
  createdAt?: string;
}

export type UserRole = 'BUYER' | 'SELLER' | 'MODERATOR' | 'ADMIN';

/** Урезанное представление автора/продавца/покупателя в связях. */
export interface ApiUserRef {
  id: string;
  name?: string | null;
  avatar?: string | null;
}

export type ProductType = 'PHYSICAL' | 'DIGITAL';

/** Product (schema.prisma) + seller-связь. */
export interface ApiProduct {
  id: string;
  title: string;
  description?: string | null;
  price: number;
  media: string[];
  videoUrl?: string | null;
  sellerId: string;
  seller?: ApiUserRef | null;
  isActive?: boolean;
  isAd?: boolean;
  type?: ProductType;
  deliveryType?: string | null;
  deliveryInfo?: unknown;
  tags?: string[];
  createdAt?: string;
}

export type OrderStatus =
  | 'PENDING'
  | 'PAID'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'CANCELLED';

export type EscrowStatus = 'NONE' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'SPLIT';

/** Product-связь внутри заказа — только то, что рендерит UI. */
export interface ApiOrderProduct {
  id: string;
  title: string;
  price?: number;
  media?: string[];
}

/** Order (schema.prisma) + product-связь. */
export interface ApiOrder {
  id: string;
  buyerId: string;
  sellerId: string;
  productId?: string | null;
  product?: ApiOrderProduct | null;
  amount: number;
  status: OrderStatus;
  escrowStatus?: EscrowStatus;
  escrowAmount?: number;
  priceSource?: 'PRODUCT' | 'DEAL';
  createdAt: string;
  paidAt?: string | null;
  shippedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  /** Платёжная часть, которую бэкенд подмешивает в ответ createOrder/payOrder. */
  payment?: ApiPayment | null;
}

export type TransactionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SWEPT'
  | 'FAILED'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'REFUNDED';

/** Ответ платёжных эндпоинтов /payments/order/:id/{pay,status}. */
export interface ApiPayment {
  depositAddress?: string | null;
  clientRef?: string | null;
  status?: string | null;
}

/** Transaction (schema.prisma). */
export interface ApiTransaction {
  id: string;
  orderId: string;
  type: string;
  amount: number;
  status: TransactionStatus;
  provider?: 'NOWPAYMENTS' | 'PAYMOD';
  txHash?: string | null;
  createdAt: string;
}

export type PayoutStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

/** WithdrawalRequest (schema.prisma) — status строкой (pending/approved/rejected). */
export interface ApiWithdrawal {
  id: string;
  userId: string;
  amount: number;
  status: string;
  toAddress?: string | null;
  payoutStatus?: PayoutStatus;
  payoutTxHash?: string | null;
  createdAt: string;
}

/** Post (schema.prisma) + author/adOwner-связи и счётчики ленты. */
export interface ApiPost {
  id: string;
  title: string;
  content?: string | null;
  link?: string | null;
  media?: string[] | string | null;
  videoUrl?: string | null;
  authorId?: string;
  author?: ApiUserRef | null;
  isAd?: boolean;
  adOwnerId?: string | null;
  adOwner?: ApiUserRef | null;
  adExpireDate?: string | null;
  isPinned?: boolean;
  isHidden?: boolean;
  orderId?: string | null;
  createdAt: string;
  /** Агрегаты, которые считает бэкенд. */
  likeCount?: number;
  likedByMe?: boolean;
  commentCount?: number;
}

/** Comment (schema.prisma) + user-связь. */
export interface ApiComment {
  id: string;
  text: string;
  userId: string;
  user?: ApiUserRef | null;
  postId: string;
  createdAt: string;
}

/**
 * Invite (schema.prisma) + связи, которые добавляет
 * InvitesService.findAll (include owner/usedBy).
 */
export interface ApiInvite {
  code: string;
  ownerId: string;
  usedById?: string | null;
  owner?: ApiUserRef | null;
  usedBy?: ApiUserRef | null;
  isUsed: boolean;
  createdAt: string;
  expiresAt?: string | null;
}

/** Настройки платформы: GET /settings → { key: value }. */
export type ApiSettings = Record<string, string>;

/** Дашборд админки — агрегаты, которые считает бэкенд. */
export interface ApiAdminDashboard {
  usersCount?: number;
  productsCount?: number;
  ordersCount?: number;
  totalRevenue?: number;
}

/** Ответ becomeSeller: новый пользователь + обновлённый токен. */
export interface BecomeSellerResponse {
  user: ApiUser;
  accessToken: string;
}

/** A4: заявка «Стать продавцом». status=null — заявки не было. */
export type SellerRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApiSellerRequest {
  id?: string;
  userId?: string;
  status: SellerRequestStatus | null;
  note?: string | null;
  createdAt?: string;
  reviewedAt?: string | null;
  alreadySeller?: boolean;
}

/** A4: заявка в списке админки — с вложенным юзером. */
export interface ApiSellerRequestAdmin extends ApiSellerRequest {
  id: string;
  userId: string;
  user?: { id: string; name?: string | null; phone?: string; role?: string };
}

/** Пара токенов от /auth/login и /auth/register. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Реферальный заказ в /users/me/referrals. */
export interface ApiReferral {
  id: string;
  referralBonus?: number;
  createdAt?: string;
  buyer?: ApiUserRef | null;
  product?: { id: string; title: string } | null;
}

/** Статистика профиля — GET /users/me/stats. */
export interface ApiUserStats {
  boughtCount: number;
  soldCount: number;
  soldEarned?: number;
  referralEarned?: number;
  bonusBalance?: number;
}

/** Пагинированный ответ списочных эндпоинтов. */
export interface ApiPage<T> {
  items: T[];
  total?: number;
  page?: number;
  pages?: number;
}

/**
 * Ответ эндпоинтов, которые ВСЕГДА отдают номер страницы и их количество
 * (лента, каталог). Позволяет читать page/pages без optional-chaining.
 */
export interface ApiPaginated<T> {
  items: T[];
  total?: number;
  page: number;
  pages: number;
}

/** Идентифицируемая сущность — для слияния страниц пагинации. */
export interface WithId {
  id: string;
}

/** Мета сообщения Базара (schema.prisma: BazarMessage.meta, Json?). */
export interface BazarMeta {
  blocked?: boolean;
  relay?: boolean;
  originRole?: 'buyer' | 'seller';
  action?: { intent?: string };
}

/** Ссылка на товар/пост внутри ответа Базара. */
export interface BazarReply {
  id: string;
  amount?: number;
  status?: string;
  escrowStatus?: string;
  depositAddress?: string | null;
}

/** Ответ ретрансляции сообщения в сделке. */
export interface BazarRelayResult {
  blocked?: boolean;
  message?: unknown;
}