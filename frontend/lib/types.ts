// API response types matching backend schemas

export interface ItemTags {
  colors: string[];
  primary_color?: string;
  pattern?: string;
  material?: string;
  style: string[];
  season: string[];
  formality?: string;
  fit?: string;
  occasion?: string[];
  brand?: string;
  condition?: string;
  features?: string[];
  logprobs_confidence?: number;
}

/** One fibre of a garment's composition, e.g. 60% cotton. */
export interface CareComposition {
  fiber: string;
  percent?: number | null;
}

/**
 * Care-label data. Everything is optional: a label read by AI and one typed in
 * by hand produce the same shape, just filled in to different depths.
 */
export interface CareInfo {
  composition: CareComposition[];
  wash?: {
    machine?: boolean | null;
    hand_wash?: boolean | null;
    do_not_wash?: boolean | null;
    max_temp_c?: number | null;
    cycle?: 'normal' | 'gentle' | 'delicate' | null;
  } | null;
  bleach?: 'any' | 'non_chlorine' | 'none' | null;
  dry?: {
    tumble_dry?: boolean | null;
    tumble_heat?: 'low' | 'medium' | 'high' | null;
    line_dry?: boolean | null;
    flat_dry?: boolean | null;
  } | null;
  iron?: {
    allowed?: boolean | null;
    max_temp_c?: number | null;
    steam?: boolean | null;
  } | null;
  professional?: {
    dry_clean?: boolean | null;
    code?: string | null;
  } | null;
  notes?: string | null;
  source: 'ai' | 'manual';
}

/**
 * What the owner told us to do with one garment: «sácala más», «normal» or
 * «déjala tranquila». `rest` only silences the nudging — archiving is what takes
 * a garment out of the suggestions.
 */
export type UsagePreference = 'more' | 'normal' | 'rest';

export interface Item {
  id: string;
  user_id: string;
  type: string;
  subtype?: string;
  name?: string;
  brand?: string;
  notes?: string;
  purchase_date?: string;
  purchase_price?: number;
  favorite: boolean;
  image_path: string;
  thumbnail_path?: string;
  medium_path?: string;
  original_image_path?: string | null;
  image_url?: string;
  thumbnail_url?: string;
  medium_url?: string;
  tags: ItemTags;
  colors: string[];
  primary_color?: string;
  /**
   * The shade actually sampled off the garment, as `#rrggbb`. Display only:
   * `primary_color` stays the family that matching, filters and the stylist all
   * reason on, so two different browns are both "marrón". Null on every item
   * uploaded before this existed — use `swatchHex` rather than reading it raw.
   */
  primary_color_hex?: string | null;
  status: 'processing' | 'ready' | 'error' | 'archived';
  ai_processed: boolean;
  ai_confidence?: number;
  ai_description?: string;
  tagging_status: 'pending' | 'tagged';
  tagged_by?: 'auto' | 'manual' | null;
  tagged_at?: string | null;
  wear_count: number;
  usage_preference: UsagePreference;
  last_worn_at?: string;
  last_suggested_at?: string;
  suggestion_count: number;
  acceptance_count: number;
  wears_since_wash: number;
  last_washed_at?: string;
  wash_interval?: number;
  needs_wash: boolean;
  effective_wash_interval: number;
  source_url?: string | null;
  care?: CareInfo | null;
  care_hints: string[];
  additional_images: ItemImage[];
  is_archived: boolean;
  archived_at?: string;
  archive_reason?: string;
  created_at: string;
  updated_at: string;
}

/** A garment this one goes out with, and how many worn looks they shared. */
export interface CoWornItem {
  id: string;
  name: string | null;
  type: string;
  thumbnail_path: string | null;
  thumbnail_url: string | null;
  times: number;
}

/** GET /items/:id/usage — veces puesta, coste por uso y con qué se combina. */
export interface ItemUsage {
  wear_count: number;
  last_worn_at: string | null;
  days_since_last_worn: number | null;
  purchase_price: number | string | null;
  /** null means we cannot say: no price saved, or nothing worn yet. */
  cost_per_wear: number | string | null;
  usage_preference: UsagePreference;
  co_worn: CoWornItem[];
  /** How many worn looks the co-wear counts come from. */
  co_worn_looks: number;
}

export interface ItemListResponse {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface ItemFilter {
  type?: string;
  subtype?: string;
  colors?: string[];
  status?: string;
  favorite?: boolean;
  needs_wash?: boolean;
  is_archived?: boolean;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  ids?: string;
}

export interface StyleProfile {
  casual: number;
  formal: number;
  sporty: number;
  minimalist: number;
  bold: number;
}

export interface AIEndpoint {
  name: string;
  url: string;
  vision_model: string;
  text_model: string;
  enabled: boolean;
}

export interface Preferences {
  color_favorites: string[];
  color_avoid: string[];
  style_profile: StyleProfile;
  default_occasion: string;
  temperature_unit: 'celsius' | 'fahrenheit';
  temperature_sensitivity: 'low' | 'normal' | 'high';
  cold_threshold: number;
  hot_threshold: number;
  layering_preference: 'minimal' | 'moderate' | 'heavy';
  avoid_repeat_days: number;
  prefer_underused_items: boolean;
  variety_level: 'low' | 'moderate' | 'high';
  ai_endpoints: AIEndpoint[];
}

// Color options for the app — the canonical named palette. Values are the tag
// vocabulary shared with the AI tagger (clothing_analysis.txt) and the scorer;
// display names come from messages `tagValues.colors` (see lib/tag-labels.ts).
// Hex values tuned for typical clothing colors, not pure/saturated colors
export const CLOTHING_COLORS = [
  { name: 'Black', value: 'black', hex: '#1a1a1a' },
  { name: 'Charcoal', value: 'charcoal', hex: '#36454F' },
  { name: 'Gray', value: 'gray', hex: '#808080' },
  { name: 'White', value: 'white', hex: '#FAFAFA' },
  { name: 'Cream', value: 'cream', hex: '#F5F5DC' },
  { name: 'Beige', value: 'beige', hex: '#D4C4A8' },
  { name: 'Tan', value: 'tan', hex: '#C19A6B' },
  { name: 'Khaki', value: 'khaki', hex: '#A89F6B' },
  { name: 'Olive', value: 'olive', hex: '#707B52' },
  { name: 'Army Green', value: 'army-green', hex: '#5B6340' },
  { name: 'Green', value: 'green', hex: '#4A7C59' },
  { name: 'Teal', value: 'teal', hex: '#367588' },
  { name: 'Navy', value: 'navy', hex: '#1B2A4A' },
  { name: 'Blue', value: 'blue', hex: '#4A7DB8' },
  { name: 'Light Blue', value: 'light-blue', hex: '#9CC3E4' },
  { name: 'Brown', value: 'brown', hex: '#8B5A3C' },
  { name: 'Dark Brown', value: 'dark-brown', hex: '#5C4033' },
  { name: 'Burgundy', value: 'burgundy', hex: '#722F37' },
  { name: 'Red', value: 'red', hex: '#C44536' },
  { name: 'Pink', value: 'pink', hex: '#E8A0B0' },
  { name: 'Purple', value: 'purple', hex: '#6B5B7A' },
  { name: 'Yellow', value: 'yellow', hex: '#D4A84B' },
  { name: 'Orange', value: 'orange', hex: '#D2691E' },
  { name: 'Gold', value: 'gold', hex: '#C9A227' },
  { name: 'Silver', value: 'silver', hex: '#BFC1C2' },
] as const;

// Clothing types — must match the TYPE vocabulary in clothing_analysis.txt
export const CLOTHING_TYPES = [
  { label: 'Shirt', value: 'shirt' },
  { label: 'T-Shirt', value: 't-shirt' },
  { label: 'Top', value: 'top' },
  { label: 'Polo', value: 'polo' },
  { label: 'Blouse', value: 'blouse' },
  { label: 'Tank Top', value: 'tank-top' },
  { label: 'Sweater', value: 'sweater' },
  { label: 'Hoodie', value: 'hoodie' },
  { label: 'Cardigan', value: 'cardigan' },
  { label: 'Vest', value: 'vest' },
  { label: 'Pants', value: 'pants' },
  { label: 'Jeans', value: 'jeans' },
  { label: 'Shorts', value: 'shorts' },
  { label: 'Skirt', value: 'skirt' },
  { label: 'Dress', value: 'dress' },
  { label: 'Jumpsuit', value: 'jumpsuit' },
  { label: 'Jacket', value: 'jacket' },
  { label: 'Blazer', value: 'blazer' },
  { label: 'Coat', value: 'coat' },
  { label: 'Suit', value: 'suit' },
  { label: 'Shoes', value: 'shoes' },
  { label: 'Sneakers', value: 'sneakers' },
  { label: 'Boots', value: 'boots' },
  { label: 'Sandals', value: 'sandals' },
  { label: 'Socks', value: 'socks' },
  { label: 'Tie', value: 'tie' },
  { label: 'Hat', value: 'hat' },
  { label: 'Scarf', value: 'scarf' },
  { label: 'Belt', value: 'belt' },
  { label: 'Bag', value: 'bag' },
  { label: 'Accessories', value: 'accessories' },
] as const;

// Slugs only: the labels live in messages `suggest.occasions.<value>` so the
// Spanish UI never shows the raw English slug.
export const OCCASIONS = [
  { value: 'casual' },
  { value: 'office' },
  { value: 'formal' },
  { value: 'date' },
  { value: 'sporty' },
  { value: 'outdoor' },
] as const;

// Family types
export interface FamilyMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string;
  role: 'admin' | 'member';
  created_at: string;  // When user joined the family
}

export interface PendingInvite {
  id: string;
  email: string;
  created_at: string;  // When invite was sent
  expires_at: string;
}

export interface Family {
  id: string;
  name: string;
  invite_code: string;
  members: FamilyMember[];
  pending_invites: PendingInvite[];
  created_at: string;
}

export interface FamilyCreateResponse {
  id: string;
  name: string;
  invite_code: string;
  role: string;
}

export interface JoinFamilyResponse {
  family_id: string;
  family_name: string;
  role: string;
}

// Multi-image types
export interface ItemImage {
  id: string;
  item_id: string;
  image_path: string;
  thumbnail_path?: string;
  medium_path?: string;
  position: number;
  created_at: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
}

// Wash tracking types
export interface WashHistoryEntry {
  id: string;
  item_id: string;
  washed_at: string;
  method?: string;
  notes?: string;
  created_at: string;
}

// Family rating types
export interface FamilyRating {
  id: string;
  user_id: string;
  user_display_name: string;
  user_avatar_url?: string;
  rating: number;
  comment?: string;
  created_at: string;
}

// Outfit types
export interface OutfitItem {
  id: string;
  type: string;
  subtype?: string;
  name?: string;
  primary_color?: string;
  colors: string[];
  image_path: string;
  thumbnail_path?: string;
  image_url?: string;
  thumbnail_url?: string;
  layer_type?: string;
  position: number;
}

export interface WeatherData {
  temperature: number;
  feels_like: number;
  humidity: number;
  precipitation_chance: number;
  condition: string;
  /** Localized human label derived from condition_code. Prefer over `condition` for display. */
  condition_label?: string | null;
}

export interface FeedbackSummary {
  rating?: number;
  comment?: string;
  worn_at?: string;
}

export type OutfitSource = 'scheduled' | 'on_demand' | 'manual' | 'pairing' | 'stinky_chat';

export interface MusicInspiration {
  artist?: string;
  track?: string;
  label: string;
  tags: string[];
}

export interface Outfit {
  id: string;
  occasion: string;
  scheduled_for: string;
  status: 'pending' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  source: OutfitSource;
  reasoning?: string;
  style_notes?: string;
  highlights?: string[];
  weather?: WeatherData;
  items: OutfitItem[];
  feedback?: FeedbackSummary;
  family_ratings?: FamilyRating[];
  family_rating_average?: number;
  family_rating_count?: number;
  music_inspiration?: MusicInspiration;
  created_at: string;
}

export interface SuggestRequest {
  occasion: string;
  weather_override?: {
    temperature: number;
    feels_like?: number;
    humidity: number;
    precipitation_chance: number;
    condition: string;
  };
  exclude_items?: string[];
  include_items?: string[];
  song_query?: string;
  /** Exact Spotify track id picked from /music/search (optional). */
  song_track_id?: string;
}

// Pairing types
export interface SourceItem {
  id: string;
  type: string;
  subtype?: string;
  name?: string;
  primary_color?: string;
  image_path: string;
  thumbnail_path?: string;
  image_url?: string;
  thumbnail_url?: string;
}

export interface Pairing extends Outfit {
  source_item?: SourceItem;
}

export interface PairingListResponse {
  pairings: Pairing[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface GeneratePairingsRequest {
  num_pairings: number;
}

export interface GeneratePairingsResponse {
  generated: number;
  pairings: Pairing[];
}
