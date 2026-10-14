'use client';

import { useEffect, useState } from 'react';

import { PhotoLook } from '@/components/selfie/photo-look';

/** «Recrea este look con mi ropa»: /dashboard/pins/recreate?pin=<id>. */
export default function RecreatePinPage() {
  // Read on the client: the id only matters once we are in the browser, and this
  // keeps the page out of a Suspense boundary for useSearchParams.
  const [pinId, setPinId] = useState<string | null>(null);
  useEffect(() => {
    setPinId(new URLSearchParams(window.location.search).get('pin'));
  }, []);
  return pinId ? <PhotoLook key={pinId} pinId={pinId} /> : null;
}
