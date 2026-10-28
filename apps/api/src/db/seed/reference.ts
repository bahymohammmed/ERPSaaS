import type { Client } from 'pg';

type CurrencySeed = [code: string, nameAr: string, nameEn: string, minorUnits: number, minorAr: string, minorEn: string];

/** ISO 4217 minor units. KWD, BHD, OMR, JOD, IQD, LYD, TND use 3 decimals. */
export const CURRENCIES: CurrencySeed[] = [
  ['KWD', 'دينار كويتي', 'Kuwaiti Dinar', 3, 'فلس', 'fils'],
  ['SAR', 'ريال سعودي', 'Saudi Riyal', 2, 'هللة', 'halala'],
  ['AED', 'درهم إماراتي', 'UAE Dirham', 2, 'فلس', 'fils'],
  ['BHD', 'دينار بحريني', 'Bahraini Dinar', 3, 'فلس', 'fils'],
  ['QAR', 'ريال قطري', 'Qatari Riyal', 2, 'درهم', 'dirham'],
  ['OMR', 'ريال عماني', 'Omani Rial', 3, 'بيسة', 'baisa'],
  ['EGP', 'جنيه مصري', 'Egyptian Pound', 2, 'قرش', 'piastre'],
  ['JOD', 'دينار أردني', 'Jordanian Dinar', 3, 'فلس', 'fils'],
  ['LBP', 'ليرة لبنانية', 'Lebanese Pound', 2, 'قرش', 'piastre'],
  ['IQD', 'دينار عراقي', 'Iraqi Dinar', 3, 'فلس', 'fils'],
  ['TND', 'دينار تونسي', 'Tunisian Dinar', 3, 'مليم', 'millime'],
  ['MAD', 'درهم مغربي', 'Moroccan Dirham', 2, 'سنتيم', 'centime'],
  ['USD', 'دولار أمريكي', 'US Dollar', 2, 'سنت', 'cent'],
  ['EUR', 'يورو', 'Euro', 2, 'سنت', 'cent'],
  ['GBP', 'جنيه إسترليني', 'Pound Sterling', 2, 'بنس', 'penny'],
  ['CHF', 'فرنك سويسري', 'Swiss Franc', 2, 'سنتيم', 'centime'],
  ['JPY', 'ين ياباني', 'Japanese Yen', 0, '', ''],
  ['CNY', 'يوان صيني', 'Chinese Yuan', 2, 'فين', 'fen'],
  ['INR', 'روبية هندية', 'Indian Rupee', 2, 'بيسة', 'paisa'],
  ['PKR', 'روبية باكستانية', 'Pakistani Rupee', 2, 'بيسة', 'paisa'],
  ['PHP', 'بيزو فلبيني', 'Philippine Peso', 2, 'سنتافو', 'centavo'],
  ['TRY', 'ليرة تركية', 'Turkish Lira', 2, 'قرش', 'kurus'],
  ['CAD', 'دولار كندي', 'Canadian Dollar', 2, 'سنت', 'cent'],
  ['AUD', 'دولار أسترالي', 'Australian Dollar', 2, 'سنت', 'cent'],
];

export const seedReferenceData = async (client: Client): Promise<void> => {
  for (const [code, nameAr, nameEn, minor, minorAr, minorEn] of CURRENCIES) {
    await client.query(
      `INSERT INTO core.currencies (code, name_ar, name_en, minor_units, minor_name_ar, minor_name_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
         minor_units = EXCLUDED.minor_units, minor_name_ar = EXCLUDED.minor_name_ar, minor_name_en = EXCLUDED.minor_name_en`,
      [code, nameAr, nameEn, minor, minorAr, minorEn],
    );
  }
};
