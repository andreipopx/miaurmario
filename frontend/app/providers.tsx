'use client';

import { QueryClient, QueryClientProvider, QueryCache, MutationCache, Query } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState } from 'react';
import { toast, Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/components/auth-provider';
import {
  ApiError,
  NetworkError,
  getGenericErrorMessage,
  resolveErrorMessage,
} from '@/lib/api';
import { ApiErrorMessages } from '@/components/api-error-messages';
import { getAiAccessErrorCode } from '@/lib/ai-access';
import { useCaptureInstallPrompt } from '@/lib/pwa/install-prompt';

// Queries that expect a 404 as a legitimate "not configured yet" state
// (e.g. user has no family, no location set) should tag themselves with
//   useQuery({ meta: { silent404: true } })
// so we don't spam the user with red toasts on first login.
// Toast copy always comes from the message catalogue: the backend's English
// `message` is for logs only (see lib/api.ts).
function toastText(error: unknown): string {
  return resolveErrorMessage(error) ?? getGenericErrorMessage();
}

function handleQueryError(error: unknown, query: Query<unknown, unknown, unknown>) {
  const meta = (query.meta ?? {}) as { silent404?: boolean; silentStatuses?: number[] };
  if (error instanceof ApiError) {
    if (error.status === 401) return; // handled by auth redirect
    if (meta.silent404 && error.status === 404) return;
    if (meta.silentStatuses?.includes(error.status)) return;
    if (error.status === 503) {
      toast.error(toastText(error), { duration: 8000 });
      return;
    }
    toast.error(toastText(error));
    return;
  }
  if (error instanceof NetworkError) {
    toast.error(toastText(error));
  }
}

function handleMutationError(
  error: unknown,
  _variables?: unknown,
  _context?: unknown,
  mutation?: { meta?: Record<string, unknown> }
) {
  // Mutations that render their own (translated) error opt out with meta.silentErrors.
  if (mutation?.meta?.silentErrors) return;
  // "No AI for this account" is shown as a friendly inline notice where the
  // feature lives, never as a red toast.
  if (getAiAccessErrorCode(error)) return;
  if (error instanceof NetworkError) {
    toast.error(toastText(error));
  } else if (error instanceof ApiError) {
    if (error.status === 401) return;
    if (error.status === 503) {
      toast.error(toastText(error), { duration: 8000 });
    } else {
      toast.error(toastText(error));
    }
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Android/desktop Chromium fire beforeinstallprompt once, early: keep it for the install guide.
  useCaptureInstallPrompt();
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
            <ApiErrorMessages />
            {children}
            <Toaster position="top-center" />
          </ThemeProvider>
        </QueryClientProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
