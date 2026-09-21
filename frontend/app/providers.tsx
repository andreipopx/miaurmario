'use client';

import { QueryClient, QueryClientProvider, QueryCache, MutationCache, Query } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState } from 'react';
import { toast, Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/components/auth-provider';
import { ApiError, NetworkError } from '@/lib/api';
import { getAiAccessErrorCode } from '@/lib/ai-access';

// Queries that expect a 404 as a legitimate "not configured yet" state
// (e.g. user has no family, no location set) should tag themselves with
//   useQuery({ meta: { silent404: true } })
// so we don't spam the user with red toasts on first login.
function handleQueryError(error: unknown, query: Query<unknown, unknown, unknown>) {
  const meta = (query.meta ?? {}) as { silent404?: boolean; silentStatuses?: number[] };
  if (error instanceof ApiError) {
    if (error.status === 401) return; // handled by auth redirect
    if (meta.silent404 && error.status === 404) return;
    if (meta.silentStatuses?.includes(error.status)) return;
    if (error.status === 503) {
      toast.error(error.message, { duration: 8000 });
      return;
    }
    toast.error(error.message);
    return;
  }
  if (error instanceof NetworkError) {
    toast.error(error.message);
  }
}

function handleMutationError(error: unknown) {
  // "No AI for this account" is shown as a friendly inline notice where the
  // feature lives, never as a red toast.
  if (getAiAccessErrorCode(error)) return;
  if (error instanceof NetworkError) {
    toast.error(error.message);
  } else if (error instanceof ApiError) {
    if (error.status === 401) return;
    if (error.status === 503) {
      toast.error(error.message, { duration: 8000 });
    } else {
      toast.error(error.message);
    }
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: (failureCount, error) => {
              // Don't retry on auth errors or client errors
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              // Don't retry network errors (user is likely offline)
              if (error instanceof NetworkError) {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
        queryCache: new QueryCache({
          onError: handleQueryError,
        }),
        mutationCache: new MutationCache({
          onError: handleMutationError,
        }),
      })
  );

  return (
    <SessionProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster richColors position="top-center" />
          </ThemeProvider>
        </QueryClientProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
