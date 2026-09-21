/**
 * IANA timezone helpers for the searchable timezone picker.
 *
 * The list comes from Intl.supportedValuesOf('timeZone') (every modern
 * browser); older engines fall back to a compact list of common zones. Labels
 * read "Europa/Madrid (UTC+2)" in Spanish, with Spanish exonyms for the
 * regions and for well-known cities; everything else keeps the IANA city with
 * underscores turned into spaces.
 */

export const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Istanbul',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Africa/Casablanca',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Sao_Paulo',
  'America/Havana',
  'America/Santo_Domingo',
  'America/Puerto_Rico',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

/**
 * ICU (and so Intl) still reports some pre-2022 IANA names. The backend's
 * zoneinfo database only has the current ones, so always use these.
 * Keep in sync with LEGACY_TIMEZONE_ALIASES in backend/app/utils/timezone.py.
 */
export const LEGACY_TIMEZONE_ALIASES: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

export function canonicalTimezone(timeZone: string): string {
  return LEGACY_TIMEZONE_ALIASES[timeZone] ?? timeZone;
}

const REGION_ES: Record<string, string> = {
  Africa: 'África',
  America: 'América',
  Antarctica: 'Antártida',
  Arctic: 'Ártico',
  Asia: 'Asia',
  Atlantic: 'Atlántico',
  Australia: 'Australia',
  Europe: 'Europa',
  Indian: 'Índico',
  Pacific: 'Pacífico',
  Argentina: 'Argentina',
  Indiana: 'Indiana',
  Kentucky: 'Kentucky',
  North_Dakota: 'Dakota del Norte',
};

const CITY_ES: Record<string, string> = {
  // Europe
  London: 'Londres',
  Paris: 'París',
  Berlin: 'Berlín',
  Rome: 'Roma',
  Lisbon: 'Lisboa',
  Brussels: 'Bruselas',
  Amsterdam: 'Ámsterdam',
  Stockholm: 'Estocolmo',
  Copenhagen: 'Copenhague',
  Athens: 'Atenas',
  Warsaw: 'Varsovia',
  Prague: 'Praga',
  Vienna: 'Viena',
  Zurich: 'Zúrich',
  Bucharest: 'Bucarest',
  Istanbul: 'Estambul',
  Moscow: 'Moscú',
  Kyiv: 'Kiev',
  Helsinki: 'Helsinki',
  Dublin: 'Dublín',
  Luxembourg: 'Luxemburgo',
  Monaco: 'Mónaco',
  Andorra: 'Andorra',
  Belgrade: 'Belgrado',
  Budapest: 'Budapest',
  Sofia: 'Sofía',
  Vilnius: 'Vilna',
  Riga: 'Riga',
  Tallinn: 'Tallin',
  Minsk: 'Minsk',
  Chisinau: 'Chisináu',
  Tirane: 'Tirana',
  Skopje: 'Skopie',
  Vatican: 'Vaticano',
  Gibraltar: 'Gibraltar',
  Malta: 'Malta',
  Oslo: 'Oslo',
  Ljubljana: 'Liubliana',
  Zagreb: 'Zagreb',
  Sarajevo: 'Sarajevo',
  Canary: 'Canarias',
  Azores: 'Azores',
  Madeira: 'Madeira',
  Reykjavik: 'Reikiavik',
  Ceuta: 'Ceuta',
  // Americas
  New_York: 'Nueva York',
  Los_Angeles: 'Los Ángeles',
  Chicago: 'Chicago',
  Denver: 'Denver',
  Mexico_City: 'Ciudad de México',
  Bogota: 'Bogotá',
  Lima: 'Lima',
  Caracas: 'Caracas',
  Santiago: 'Santiago de Chile',
  Buenos_Aires: 'Buenos Aires',
  Montevideo: 'Montevideo',
  Sao_Paulo: 'São Paulo',
  Havana: 'La Habana',
  Santo_Domingo: 'Santo Domingo',
  Puerto_Rico: 'Puerto Rico',
  Panama: 'Panamá',
  Costa_Rica: 'Costa Rica',
  Guatemala: 'Guatemala',
  El_Salvador: 'El Salvador',
  Tegucigalpa: 'Tegucigalpa',
  Managua: 'Managua',
  Asuncion: 'Asunción',
  La_Paz: 'La Paz',
  Guayaquil: 'Guayaquil',
  Toronto: 'Toronto',
  Vancouver: 'Vancouver',
  Montreal: 'Montreal',
  Anchorage: 'Anchorage',
  Phoenix: 'Phoenix',
  Cancun: 'Cancún',
  Tijuana: 'Tijuana',
  Monterrey: 'Monterrey',
  Merida: 'Mérida',
  Jamaica: 'Jamaica',
  // Africa / Middle East / Asia / Oceania
  Casablanca: 'Casablanca',
  Cairo: 'El Cairo',
  Algiers: 'Argel',
  Tunis: 'Túnez',
  Tripoli: 'Trípoli',
  Johannesburg: 'Johannesburgo',
  Nairobi: 'Nairobi',
  Lagos: 'Lagos',
  Malabo: 'Malabo',
  Dubai: 'Dubái',
  Riyadh: 'Riad',
  Tehran: 'Teherán',
  Jerusalem: 'Jerusalén',
  Beirut: 'Beirut',
  Baghdad: 'Bagdad',
  Kolkata: 'Calcuta',
  Kathmandu: 'Katmandú',
  Karachi: 'Karachi',
  Bangkok: 'Bangkok',
  Singapore: 'Singapur',
  Shanghai: 'Shanghái',
  Hong_Kong: 'Hong Kong',
  Tokyo: 'Tokio',
  Seoul: 'Seúl',
  Manila: 'Manila',
  Jakarta: 'Yakarta',
  Taipei: 'Taipéi',
  Sydney: 'Sídney',
  Melbourne: 'Melbourne',
  Perth: 'Perth',
  Auckland: 'Auckland',
  Honolulu: 'Honolulu',
  Easter: 'Isla de Pascua',
  Galapagos: 'Galápagos',
};

export interface TimezoneOption {
  value: string;
  label: string;
  offsetMinutes: number;
  /** Lower-cased, accent-free text to match against (label + IANA id). */
  search: string;
}

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_/]/g, ' ');
}

export function getAllTimezones(): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf === 'function') {
      zones = intl.supportedValuesOf('timeZone');
    }
  } catch {
    zones = [];
  }
  if (!zones.length) zones = [...FALLBACK_TIMEZONES];
  const unique = Array.from(new Set(zones.map(canonicalTimezone)));
  // Some engines omit UTC from the list; it is a valid choice.
  return unique.includes('UTC') ? unique : ['UTC', ...unique];
}

export function getBrowserTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? canonicalTimezone(tz) : undefined;
  } catch {
    return undefined;
  }
}

/** Current UTC offset of a zone in minutes (DST-aware for `at`). */
export function getOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
  } catch {
    return 0;
  }
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** "Europe/Madrid" -> "Europa/Madrid" (es) or "Europe/Madrid" (en). */
export function formatTimezoneName(timeZone: string, locale: string = 'es'): string {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 'UTC';
  const parts = timeZone.split('/');
  const spanish = locale.startsWith('es');
  return parts
    .map((part, i) => {
      if (spanish) {
        if (i === 0 || i < parts.length - 1) {
          if (REGION_ES[part]) return REGION_ES[part];
        } else if (CITY_ES[part]) {
          return CITY_ES[part];
        }
      }
      return part.replace(/_/g, ' ');
    })
    .join('/');
}

/** "Europa/Madrid (UTC+2)". */
export function formatTimezoneLabel(timeZone: string, locale: string = 'es', at?: Date): string {
  const name = formatTimezoneName(timeZone, locale);
  if (name === 'UTC') return 'UTC';
  return `${name} (${formatOffset(getOffsetMinutes(timeZone, at))})`;
}

export function buildTimezoneOptions(locale: string = 'es', at?: Date): TimezoneOption[] {
  return getAllTimezones()
    .map((value) => {
      const label = formatTimezoneLabel(value, locale, at);
      return {
        value,
        label,
        offsetMinutes: getOffsetMinutes(value, at),
        search: normalizeForSearch(`${label} ${value}`),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

export function filterTimezoneOptions(
  options: TimezoneOption[],
  query: string,
  limit = 60
): TimezoneOption[] {
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return options.slice(0, limit);
  const out: TimezoneOption[] = [];
  for (const option of options) {
    if (terms.every((term) => option.search.includes(term))) {
      out.push(option);
      if (out.length >= limit) break;
    }
  }
  return out;
}
