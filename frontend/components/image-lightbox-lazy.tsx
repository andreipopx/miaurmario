'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLightbox } from '@/lib/lightbox-context';

// The lightbox library (and its three stylesheets) is only fetched the first time a
// photo is opened full screen, not with every screen of the app.
const ImageLightbox = dynamic(
  () => import('@/components/image-lightbox').then((m) => m.ImageLightbox),
  { ssr: false }
);

export function LazyImageLightbox() {
  const { visible } = useLightbox();
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (visible) setWanted(true);
  }, [visible]);
  // Fetched quietly once the screen has settled, so the first photo opens at once too.
  useEffect(() => {
    const timer = window.setTimeout(() => void import('@/components/image-lightbox'), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  return wanted ? <ImageLightbox /> : null;
}
