'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProfileMenuSheetContent } from '@/components/profile-menu';
import { useSwipeDismiss } from '@/lib/native/use-swipe-dismiss';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Mobile profile menu, opened from the profile avatar (photo or Stinky) in the header. Short on purpose:
 * profile, Ajustes, Admin (site admins), feedback and sign out — sections live in the dock.
 */
export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const closeRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // Swipe the drawer back to the left to close it, like a native side menu.
  useSwipeDismiss(panel, { direction: 'left', onDismiss: onClose, enabled: open });

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      closeRef.current?.focus();
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <div className={cn('lg:hidden', !open && 'pointer-events-none')}>
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />

      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-label={tNav('profileMenu')}
        className={cn(
          'fixed inset-y-2 left-2 z-[70] w-80 max-w-[calc(100vw-1rem)] rounded-lg bg-popover shadow-[0_20px_60px_rgba(0,0,0,0.25)] transition-[transform,visibility] duration-300 ease-out',
          open ? 'visible translate-x-0' : 'invisible -translate-x-[110%]'
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex h-full flex-col overflow-y-auto overscroll-contain p-4">
          <ProfileMenuSheetContent
            onNavigate={onClose}
            closeButton={
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="sr-only">{tCommon('close')}</span>
                <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
