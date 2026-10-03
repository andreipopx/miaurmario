import { createLucideIcon } from 'lucide-react';

/**
 * Stinky's head as a line icon (wide face, tall pointed ears), drawn on Lucide's
 * 24 px grid so it sits with the other icons: same stroke, caps and joins. The
 * outline alone: at tab-bar size eyes and a mouth only blur.
 */
export const StinkyHeadIcon = createLucideIcon('StinkyHead', [
  [
    'path',
    {
      d: 'M4.7 11.6 5.5 4c.08-.8.9-1.1 1.45-.55L10.2 6.8a9.6 9.6 0 0 1 3.6 0l3.25-3.35c.55-.55 1.37-.25 1.45.55l.8 7.6c1.1 1.3 1.6 2.8 1.45 4.3-.35 3.6-4 5.4-8.75 5.4s-8.4-1.8-8.75-5.4c-.15-1.5.35-3 1.45-4.3Z',
      key: 'head',
    },
  ],
]);
