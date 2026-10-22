/**
 * The multipart body POST /items expects, for a garment that arrives already
 * described (a shop link, a screenshot). Pure, so it is unit-tested; the photo
 * still goes through the normal pipeline (background removal, AI tagging), which
 * only fills in what is missing here.
 */

/** How a garment got in: the funnel counts these (items.created_via). */
export type CreatedVia = 'photo' | 'link' | 'screenshot';

export interface PreparedGarment {
  file: File;
  type?: string | null;
  subtype?: string | null;
  primaryColor?: string | null;
  primaryColorHex?: string | null;
  colors?: string[];
  name?: string | null;
  brand?: string | null;
  sourceUrl?: string | null;
  price?: string | number | null;
  createdVia: CreatedVia;
}

/** "29.95", 29.95, "29,95" → "29.95"; anything else → null. */
export function normalizePrice(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  return Number(text) > 0 ? text : null;
}

export function garmentFormData(g: PreparedGarment): FormData {
  const form = new FormData();
  form.append('image', g.file);
  const add = (key: string, value: string | null | undefined, max = 100) => {
    const v = value?.trim();
    if (v) form.append(key, v.slice(0, max));
  };
  add('type', g.type);
  add('subtype', g.subtype, 50);
  add('name', g.name);
  add('brand', g.brand);
  add('primary_color', g.primaryColor);
  if (g.primaryColor) add('primary_color_hex', g.primaryColorHex, 7);
  if (g.colors?.length) form.append('colors', g.colors.join(','));
  add('source_url', g.sourceUrl, 2048);
  const price = normalizePrice(g.price);
  if (price) form.append('purchase_price', price);
  form.append('created_via', g.createdVia);
  return form;
}

/** A shop price the way the user reads prices: "59,99 €" in Spanish. */
export function formatPrice(
  value: string | number | null | undefined,
  currency: string | null | undefined,
  locale: string
): string | null {
  const price = normalizePrice(value);
  if (!price) return null;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'EUR' }).format(Number(price));
  } catch {
    return `${price} ${currency ?? ''}`.trim();
  }
}
