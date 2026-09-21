import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Pill badges. Pop colours always carry ink text.
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        signature: 'bg-signature text-signature-foreground',
        amber: 'bg-pop-amber text-pop-foreground',
        sky: 'bg-pop-sky text-pop-foreground',
        mint: 'bg-pop-mint text-pop-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border-[1.5px] border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
