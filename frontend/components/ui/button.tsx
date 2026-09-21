import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Stinky pop buttons: always pills.
// default   → ink pill, white text (primary CTA: "Me lo pongo")
// secondary → gray pill, ink text ("Otra idea")
// signature → pink pill, ink text ("Añadir", highlights)
// outline   → white pill with hairline border
// ghost / link / destructive as usual.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold ring-offset-background transition-[background-color,color,box-shadow,transform,opacity,filter] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        signature: 'bg-signature text-signature-foreground hover:brightness-105',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border-[1.5px] border-border bg-background text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent dark:hover:bg-[#303030]',
        ghost: 'bg-transparent text-foreground hover:bg-accent',
        link: 'h-auto rounded-md px-0 text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground active:scale-100',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-4 text-[13px]',
        lg: 'h-[52px] px-6 text-[15px]',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
