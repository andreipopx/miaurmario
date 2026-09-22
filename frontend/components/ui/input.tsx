import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

// Pill input: white with a 1.5px hairline; ink border + soft pink ring on focus.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-12 w-full rounded-full border-[1.5px] border-input bg-background px-5 py-2 text-base text-foreground sm:text-[15px]',
          'placeholder:text-muted-foreground',
          'ring-offset-background transition-[border-color,box-shadow] duration-150',
          'focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-signature/40',
          'file:border-0 file:bg-transparent file:text-sm file:font-semibold',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
