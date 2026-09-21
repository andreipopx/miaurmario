'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** Controlled visibility (lets a form toggle several fields at once). */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  showLabel: string;
  hideLabel: string;
  /** Hide the eye button (e.g. when a sibling field owns the toggle). */
  hideToggle?: boolean;
}

/**
 * Password field with a show/hide eye button. Pass the right `autoComplete`
 * ("current-password" or "new-password") so browser and OS password managers
 * (iCloud Keychain / Face ID, Google Password Manager) offer to fill or save.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    { className, visible, onVisibleChange, showLabel, hideLabel, hideToggle, ...props },
    ref,
  ) => {
    const [internal, setInternal] = React.useState(false);
    const shown = visible ?? internal;
    const toggle = () => {
      const next = !shown;
      if (onVisibleChange) onVisibleChange(next);
      else setInternal(next);
    };

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={shown ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(!hideToggle && 'pr-11', className)}
          {...props}
        />
        {!hideToggle && (
          <button
            type="button"
            onClick={toggle}
            aria-label={shown ? hideLabel : showLabel}
            aria-pressed={shown}
            title={shown ? hideLabel : showLabel}
            className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-full"
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
