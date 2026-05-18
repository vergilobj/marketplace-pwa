import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import toast from 'react-hot-toast';

export default function AdminPage() {
  const [settings, setSettings] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    api.get('/settings').then(r => {
      const map: any = {};
      r.data.forEach((s: any) => map[s.key] = s.value);
      setSettings(map);
    });
    api.get('/users').then(r => setUsers(r.data));
  }, []);

  const updateSetting = (key: string, value: string) => {
    api.put('/settings', { key, value }).then(() => toast.success('Настройка обновлена'));
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Админ-панель</h1>
      <Card>
        <h2 className="text-xl font-bold mb-4">Настройки комиссий</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label>Комиссия платформы (%)</label>
            <Input
              value={settings.platform_fee_percent || ''}
              onChange={e => setSettings({...settings, platform_fee_percent: e.target.value})}
              onBlur={() => updateSetting('platform_fee_percent', settings.platform_fee_percent)}
            />
          </div>
          <div>
            <label>Реферальный процент (%)</label>
            <Input
              value={settings.referral_percent || ''}
              onChange={e => setSettings({...settings, referral_percent: e.target.value})}
              onBlur={() => updateSetting('referral_percent', settings.referral_percent)}
            />
          </div>
        </div>
      </Card>
      <Card>
        <h2 className="text-xl font-bold mb-4">Пользователи</h2>
        <div className="space-y-2">
          {users.map((u: any) => (
            <div key={u.id} className="flex justify-between items-center">
              <div>
                <span className="font-medium">{u.name}</span> ({u.phone}) – {u.role}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${u.isApproved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {u.isApproved ? 'Подтверждён' : 'Ожидает'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}