import { useTranslations } from 'next-intl';

/**
 * Message keys (under `weatherConditions` in messages/*.json) for the English
 * condition strings the backend emits (WMO_CODES in weather_service.py, plus
 * the manual weather-override values 'sunny' | 'cloudy' | 'rainy').
 */
const CONDITION_KEYS = {
  'sunny': 'clear',
  'mostly sunny': 'mostlyClear',
  'partly cloudy': 'partlyCloudy',
  'cloudy': 'cloudy',
  'foggy': 'foggy',
  'light drizzle': 'lightDrizzle',
  'drizzle': 'drizzle',
  'heavy drizzle': 'heavyDrizzle',
  'freezing drizzle': 'freezingDrizzle',
  'light rain': 'lightRain',
  'rain': 'rain',
  'rainy': 'rain',
  'heavy rain': 'heavyRain',
  'freezing rain': 'freezingRain',
  'light snow': 'lightSnow',
  'snow': 'snow',
  'heavy snow': 'heavySnow',
  'snow grains': 'snowGrains',
  'light showers': 'lightShowers',
  'showers': 'showers',
  'heavy showers': 'heavyShowers',
  'light snow showers': 'lightSnowShowers',
  'snow showers': 'snowShowers',
  'thunderstorm': 'thunderstorm',
  'thunderstorm with hail': 'thunderstormHail',
  'unknown': 'unknown',
} as const;

export type WeatherConditionKey = (typeof CONDITION_KEYS)[keyof typeof CONDITION_KEYS];

export function weatherConditionKey(condition: string | null | undefined): WeatherConditionKey | null {
  if (!condition) return null;
  const normalized = condition.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONDITION_KEYS, normalized)
    ? CONDITION_KEYS[normalized as keyof typeof CONDITION_KEYS]
    : null;
}

interface WeatherConditionLike {
  condition: string;
  condition_label?: string | null;
}

/**
 * Returns a formatter that renders a weather condition in the active locale.
 * Keys off the English `condition` (always present, including manual overrides
 * and outfit weather snapshots); falls back to the backend's `condition_label`
 * and finally to the raw condition text.
 */
export function useWeatherConditionLabel(): (weather: WeatherConditionLike) => string {
  const t = useTranslations('weatherConditions');
  return (weather) => {
    const key = weatherConditionKey(weather.condition);
    if (key) return t(key);
    return weather.condition_label || weather.condition;
  };
}
