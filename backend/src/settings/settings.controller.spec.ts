import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: any;
  const mockService = {
    getAll: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: mockService }],
    }).compile();
    controller = module.get<SettingsController>(SettingsController);
    service = mockService;
    jest.clearAllMocks();
    service.set.mockResolvedValue({ key: 'k', value: 'v' });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all settings', async () => {
      service.getAll.mockResolvedValue([]);
      expect(await controller.getAll()).toEqual([]);
    });
  });

  describe('update', () => {
    it('should set a setting', async () => {
      service.set.mockResolvedValue({ key: 'k', value: 'v' });
      await controller.update({ key: 'k', value: 'v' });
      expect(service.set).toHaveBeenCalledWith('k', 'v');
    });
  });

  /**
   * N1: 5 «денежных» настроек стали доступны для изменения.
   *
   * Раньше `deposit_tolerance_percent`, `order_payment_ttl_minutes`,
   * `escrow_ship_deadline_days`, `escrow_autocomplete_days`,
   * `withdrawal_min_amount` код читал, но записать их можно было только SQL.
   */
  describe('update — N1 денежные настройки', () => {
    const valid: Array<[string, string]> = [
      ['deposit_tolerance_percent', '1'],
      ['deposit_tolerance_percent', '0'],
      ['deposit_tolerance_percent', '100'],
      ['deposit_tolerance_percent', '2.5'],
      ['order_payment_ttl_minutes', '15'],
      ['order_payment_ttl_minutes', '1'],
      ['order_payment_ttl_minutes', '1440'],
      ['escrow_ship_deadline_days', '5'],
      ['escrow_ship_deadline_days', '90'],
      ['escrow_autocomplete_days', '7'],
      ['escrow_autocomplete_days', '90'],
      ['withdrawal_min_amount', '0'],
      ['withdrawal_min_amount', '100'],
      ['withdrawal_min_amount', '10.5'],
    ];

    it.each(valid)('принимает %s = %s', async (key, value) => {
      await expect(controller.update({ key, value })).resolves.toEqual({
        key: 'k',
        value: 'v',
      });
      expect(service.set).toHaveBeenCalledWith(key, value);
    });

    const invalid: Array<[string, string, string]> = [
      ['deposit_tolerance_percent', '-1', 'отрицательный допуск'],
      ['deposit_tolerance_percent', '101', 'допуск > 100%'],
      ['deposit_tolerance_percent', 'abc', 'не число'],
      ['deposit_tolerance_percent', '', 'пустая строка'],
      ['order_payment_ttl_minutes', '-5', 'отрицательный TTL'],
      ['order_payment_ttl_minutes', '0', 'нулевой TTL'],
      ['order_payment_ttl_minutes', '1441', 'TTL > суток'],
      ['order_payment_ttl_minutes', '2.5', 'дробные минуты'],
      ['escrow_ship_deadline_days', '0', 'нулевой срок отправки'],
      ['escrow_ship_deadline_days', '91', 'срок > 90 дней'],
      ['escrow_ship_deadline_days', '-3', 'отрицательный срок'],
      ['escrow_autocomplete_days', '0', 'нулевое авто-завершение'],
      ['escrow_autocomplete_days', '91', 'авто-завершение > 90'],
      ['escrow_autocomplete_days', '7.5', 'дробные дни'],
      ['withdrawal_min_amount', '-1', 'отрицательный минимум вывода'],
      ['withdrawal_min_amount', 'abc', 'не число'],
    ];

    it.each(invalid)('отклоняет %s = %s (%s)', async (key, value) => {
      await expect(controller.update({ key, value })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(service.set).not.toHaveBeenCalled();
    });

    it('не пишет значение в БД, если оно невалидно', async () => {
      await expect(
        controller.update({ key: 'escrow_autocomplete_days', value: '0' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.set).not.toHaveBeenCalled();
    });
  });

  /** Регрессия: валидация старых ключей не сломалась. */
  describe('update — старые ключи', () => {
    it('принимает platform_fee_percent = 10', async () => {
      await controller.update({ key: 'platform_fee_percent', value: '10' });
      expect(service.set).toHaveBeenCalledWith('platform_fee_percent', '10');
    });

    it('отклоняет platform_fee_percent = 150', async () => {
      await expect(
        controller.update({ key: 'platform_fee_percent', value: '150' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('отклоняет ad_price = -1', async () => {
      await expect(
        controller.update({ key: 'ad_price', value: '-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('принимает stop_words без числовой валидации', async () => {
      await controller.update({ key: 'stop_words', value: 'спам, casino' });
      expect(service.set).toHaveBeenCalledWith('stop_words', 'спам, casino');
    });
  });
});