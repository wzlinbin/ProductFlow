import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, KeyRound, LogOut, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function balanceText(balance: Record<string, unknown> | undefined): string {
  const remaining = balance?.remaining;
  const numeric = typeof remaining === "number" ? remaining : Number(remaining);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "—";
}

export function AccountPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountQuery = useQuery({ queryKey: ["account"], queryFn: api.getAccount });
  const balanceQuery = useQuery({ queryKey: ["account-balance"], queryFn: api.getBalance, retry: false });
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  const account = accountQuery.data;
  const balance = balanceQuery.data;
  const balanceError = balanceQuery.error instanceof ApiError ? balanceQuery.error.detail : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-[#060a12] dark:text-slate-100">
      <TopNav breadcrumbs="账号" onHome={() => navigate("/products")} onLogout={() => logoutMutation.mutate()} />
      <main className="mx-auto max-w-4xl px-4 py-8 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">账号</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">当前登录的 sub2api 账号与调用状态。</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <UserRound size={16} /> 基本信息
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">邮箱</dt>
                <dd className="text-right font-medium">{valueText(account?.user.email)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">用户名</dt>
                <dd className="text-right font-medium">{valueText(account?.user.username)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">角色</dt>
                <dd className="text-right font-medium">{valueText(account?.user.role)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Owner ID</dt>
                <dd className="truncate text-right font-mono text-xs">{valueText(account?.user.owner_id)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <KeyRound size={16} /> API Key
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">来源</dt>
                <dd className="text-right font-medium">{valueText(account?.user.api_key_source)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">状态</dt>
                <dd className="text-right font-medium">{valueText(account?.user.api_key_status)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">指纹</dt>
                <dd className="text-right font-mono text-xs">{valueText(account?.user.provider_key_fingerprint)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 md:col-span-2">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <CreditCard size={16} /> 余额 / 用量
            </div>
            {balanceError ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                {balanceError}
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 px-4 py-5 dark:bg-slate-900/70">
                <div className="text-sm text-slate-500 dark:text-slate-400">当前余额</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                  {balanceText(balance ?? account?.balance)}
                </div>
              </div>
            )}
          </section>
        </div>

        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          <LogOut size={16} /> 退出登录
        </button>
      </main>
    </div>
  );
}
