import { UpdateSettingDto, SETTING_KEYS } from './update-setting.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * N1: whitelist `PUT /settings` расширен 5 «денежными» настройками.
 *
 * До правки эти ключи код читал, но записать их через API было нельзя
 * (`@IsIn` отбивал 400) — только прямым SQL.
 */
describe('UpdateSettingDto — whitelist (N1)', () => {
  const N1_KEYS = [
    'deposit_tolerance_percent',
    'order_payment_ttl_minutes',
    'escrow_ship_deadline_days',
    'escrow_autocomplete_days',
    'withdrawal_min_amount',
  ];

  const validateKey = (key: string) =>
    validate(plainToInstance(UpdateSettingDto, { key, value: '1' }));

  it.each(N1_KEYS)('разрешает ключ %s', async (key) => {
    expect(await validateKey(key)).toHaveLength(0);
  });

  it.each([
    'platform_fee_percent',
    'referral_percent',
    'ad_price',
    'stop_words',
  ])('старый ключ %s по-прежнему разрешён', async (key) => {
    expect(await validateKey(key)).toHaveLength(0);
  });

  it('отклоняет неизвестный ключ', async () => {
    const errors = await validateKey('is_admin');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('отклоняет пустой key', async () => {
    const errors = await validate(
      plainToInstance(UpdateSettingDto, { key: '', value: '1' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('отклоняет пустой value', async () => {
    const errors = await validate(
      plainToInstance(UpdateSettingDto, { key: 'ad_price', value: '' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('whitelist содержит ровно 9 ключей (4 старых + 5 новых)', () => {
    expect(SETTING_KEYS).toHaveLength(9);
    for (const key of N1_KEYS) {
      expect(SETTING_KEYS).toContain(key);
    }
  });
});