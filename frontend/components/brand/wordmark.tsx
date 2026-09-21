import { cn } from '@/lib/utils';

/** "miaurmario" logotype in Bagel Fat One. The only place that font is used. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-wordmark text-2xl text-foreground', className)}>miaurmario</span>;
}
