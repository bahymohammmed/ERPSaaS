import { describe, expect, it } from 'vitest';
import { amountInWords, arabicNumberWords, englishNumberWords } from './words';

const KWD = { minor_units: 3, name_ar: 'دينار كويتي', name_en: 'Kuwaiti Dinar', minor_name_ar: 'فلس', minor_name_en: 'fils' };

describe('amount in words', () => {
  it.each([
    [1, 'واحد'],
    [2, 'اثنان'],
    [11, 'أحد عشر'],
    [21, 'واحد وعشرون'],
    [100, 'مائة'],
    [250, 'مائتان وخمسون'],
    [1000, 'ألف'],
    [2000, 'ألفان'],
    [3000, 'ثلاثة آلاف'],
    [11000, 'أحد عشر ألف'],
    [1500, 'ألف وخمسمائة'],
    [2500000, 'مليونان وخمسمائة ألف'],
    [1234567, 'مليون ومائتان وأربعة وثلاثون ألف وخمسمائة وسبعة وستون'],
  ])('Arabic %i', (n, words) => {
    expect(arabicNumberWords(n)).toBe(words);
  });

  it('English numbers', () => {
    expect(englishNumberWords(0)).toBe('zero');
    expect(englishNumberWords(1250)).toBe('one thousand two hundred and fifty');
    expect(englishNumberWords(1000021)).toBe('one million twenty-one');
  });

  it('formats KWD with fils', () => {
    expect(amountInWords('1500.250', KWD, 'ar')).toBe('فقط ألف وخمسمائة دينار كويتي ومائتان وخمسون فلس لا غير');
    expect(amountInWords('1500.250', KWD, 'en')).toBe('Only one thousand five hundred Kuwaiti Dinar and two hundred and fifty fils');
    expect(amountInWords('75', KWD, 'ar')).toBe('فقط خمسة وسبعون دينار كويتي لا غير');
  });
});
