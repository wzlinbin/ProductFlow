import { useMemo } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { api } from "./lib/api";
import { PreferencesProvider, useI18n } from "./lib/preferences";
import { GalleryPage } from "./pages/GalleryPage";
import { HelpPage } from "./pages/HelpPage";
import { LoginPage } from "./pages/LoginPage";
import { ImageChatPage } from "./pages/ImageChatPage";
import { ProductCreatePage } from "./pages/ProductCreatePage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductListPage } from "./pages/ProductListPage";
import { SettingsPage } from "./pages/SettingsPage";

function AppRoutes() {
  const { t } = useI18n();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: api.getSessionState,
    retry: false,
  });

  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-zinc-400 dark:bg-[#060a12] dark:text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="sr-only">{t("app.loading")}</span>
      </div>
    );
  }

  const authenticated = Boolean(sessionQuery.data?.authenticated);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage authenticated={authenticated} />} />
      <Route
        path="/products"
        element={authenticated ? <ProductListPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/products/new"
        element={authenticated ? <ProductCreatePage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/image-chat"
        element={authenticated ? <ImageChatPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/gallery"
        element={authenticated ? <GalleryPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/help"
        element={authenticated ? <HelpPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/settings"
        element={authenticated ? <SettingsPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/products/:productId/image-chat"
        element={authenticated ? <ImageChatPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/products/:productId"
        element={authenticated ? <ProductDetailPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={authenticated ? "/products" : "/login"} replace />} />
    </Routes>
  );
}

export function App() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-white font-sans text-zinc-900 selection:bg-zinc-200 dark:bg-[#060a12] dark:text-slate-100 dark:selection:bg-indigo-500/30">
            <AppRoutes />
          </div>
        </BrowserRouter>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
