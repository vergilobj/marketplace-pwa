import { UserRole } from '@prisma/client';

declare namespace Express {
  interface Request {
    user?: {
      sub: string;
      phone: string;
      role: UserRole;
    };
  }
}
