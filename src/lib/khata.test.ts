import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SHOP_SETTINGS,
  parseMoreThanBaqi,
  parseShopSettings,
  phoneProblem,
  phoneTail,
  readCachedSettings,
  reminderText,
  settingsCacheKey,
  whatsAppNumber,
  whatsAppReminderLink,
  writeCachedSettings,
} from './khata'

describe('WhatsApp reminder', () => {
  it('normalises Pakistani numbers to 92…', () => {
    expect(whatsAppNumber('0300-1234567')).toBe('923001234567')
    expect(whatsAppNumber('0300 123 4567')).toBe('923001234567')
    expect(whatsAppNumber('03001234567')).toBe('923001234567')
    expect(whatsAppNumber('3001234567')).toBe('923001234567')
    expect(whatsAppNumber('+92 300 1234567')).toBe('923001234567')
    expect(whatsAppNumber('00923001234567')).toBe('923001234567')
    expect(whatsAppNumber('923001234567')).toBe('923001234567')
  })

  it('rejects things that are not phone numbers', () => {
    expect(whatsAppNumber(undefined)).toBeNull()
    expect(whatsAppNumber('')).toBeNull()
    expect(whatsAppNumber('123')).toBeNull()
  })

  it('builds a wa.me link with the prefilled Roman Urdu text', () => {
    expect(reminderText('Ali', 3000, 'Khan Store')).toBe('Assalam o Alaikum Ali, aap ka baqi PKR 3,000 hai. Shukriya – Khan Store')
    const link = whatsAppReminderLink('0300-1234567', 'Ali', 3000, 'Khan Store')
    expect(link).toBe(`https://wa.me/923001234567?text=${encodeURIComponent('Assalam o Alaikum Ali, aap ka baqi PKR 3,000 hai. Shukriya – Khan Store')}`)
    expect(whatsAppReminderLink(undefined, 'Ali', 3000, 'X')).toBeNull()
  })

  it('drops the shop part when there is no name', () => {
    expect(reminderText('Ali', 500, '  ')).toBe('Assalam o Alaikum Ali, aap ka baqi PKR 500 hai. Shukriya')
  })
})

describe('khata text helpers', () => {
  it('phone tail = last 4 digits', () => {
    expect(phoneTail('0300-1234567')).toBe('4567')
    expect(phoneTail(undefined)).toBeNull()
    expect(phoneTail('12')).toBe('12')
  })

  it('phone check mirrors the server', () => {
    expect(phoneProblem('', 20)).toBeNull()
    expect(phoneProblem('0300-123 4567', 20)).toBeNull()
    expect(phoneProblem('abc', 20)).toBe('Phone number can only have digits and +')
    expect(phoneProblem('1'.repeat(21), 20)).toMatch(/20 characters/)
  })

  it('reads the Baqi out of "More than Baqi (PKR X)"', () => {
    expect(parseMoreThanBaqi('More than Baqi (PKR 1,000)')).toBe(1000)
    expect(parseMoreThanBaqi('More than Baqi (PKR 12.5)')).toBe(12.5)
    expect(parseMoreThanBaqi('This record was cancelled')).toBeNull()
    expect(parseMoreThanBaqi(undefined)).toBeNull()
  })
})

describe('settings cache', () => {
  beforeEach(() => localStorage.clear())

  it('is per Clerk user, and view-as uses a different key', () => {
    expect(settingsCacheKey('user_a')).toBe('roznaama-settings:user_a')
    expect(settingsCacheKey('user_a', 'u2')).not.toBe(settingsCacheKey('user_a'))
  })

  it('round-trips and rejects junk', () => {
    const s = { ...DEFAULT_SHOP_SETTINGS, khataEnabled: true, udhaarRecognition: 'cash' as const, updatedAt: 5 }
    writeCachedSettings('k', s)
    expect(readCachedSettings('k')).toEqual(s)
    localStorage.setItem('k', '{"khataEnabled":"yes"}')
    expect(readCachedSettings('k')).toBeNull()
    localStorage.setItem('k', 'not json')
    expect(readCachedSettings('k')).toBeNull()
    expect(parseShopSettings({ khataEnabled: true, advanceRecognition: 'x', udhaarRecognition: 'cash' })).toBeNull()
  })
})
