import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown the instant a tab is tapped while the new screen's payload is on its way, so
 * the old screen never sits frozen. Kept plain (a title and a few blocks) because it
 * is on screen for a fraction of a second; screens draw their own skeletons after.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" className="space-y-4 pt-4">
      <Skeleton className="h-9 w-40 rounded-xl" />
      <Skeleton className="h-4 w-56 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Skeleton className="aspect-[4/5]" />
        <Skeleton className="aspect-[4/5]" />
        <Skeleton className="aspect-[4/5]" />
        <Skeleton className="aspect-[4/5]" />
      </div>
    </div>
  );
}
