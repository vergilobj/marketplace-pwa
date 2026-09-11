import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async getFloat(key: string): Promise<number> {
    const val = await this.get(key);
    return val ? parseFloat(val) : 0;
  }

  /**
   * Целочисленная настройка (дни/минуты/проценты-счётчики).
   * Возвращает default, если ключа нет или значение невалидно.
   */
  async getInt(key: string, defaultValue = 0): Promise<number> {
    const val = await this.get(key);
    if (val === null || val === undefined || val === '') return defaultValue;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  async set(key: string, value: string) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getAll() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
