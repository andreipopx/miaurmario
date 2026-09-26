/**
 * `next/image` outside Next.
 *
 * The scenes mount real components, and one of them — the garment dialog — is full
 * of `<Image fill>`. Nothing about the layout depends on Next's loader, so a plain
 * `<img>` that honours `fill` is enough to photograph, and it keeps the scene honest
 * about the markup around it.
 */
import type { CSSProperties } from 'react';

export default function Image({
  src,
  alt,
  className,
  style,
  fill,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  fill?: boolean;
  sizes?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  const box: CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    : {};
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={{ ...box, ...style }} />;
}
