import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";

interface LoginPageProps {
  authenticated: boolean;
}

type AuthMode = "login" | "register";

export function LoginPage({ authenticated }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const publicSettingsQuery = useQuery({
    queryKey: ["auth-public-settings"],
    queryFn: api.getAuthPublicSettings,
    retry: false,
  });
  const publicSettings = publicSettingsQuery.data;

  useEffect(() => {
    const signedOut = window.sessionStorage.getItem("productflow:signed-out") === "1";
    if (authenticated && !signedOut) {
      navigate("/products", { replace: true });
    }
  }, [authenticated, navigate]);

  const completeAuth = async () => {
    window.sessionStorage.removeItem("productflow:signed-out");
    queryClient.removeQueries({ queryKey: ["settings-lock-state"] });
    queryClient.removeQueries({ queryKey: ["config"] });
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    navigate("/products", { replace: true });
  };

  const handleAuthResult = async (result: { requires_2fa?: boolean; challenge_id?: string | null; user_email_masked?: string | null }) => {
    if (result.requires_2fa && result.challenge_id) {
      setChallengeId(result.challenge_id);
      setMaskedEmail(result.user_email_masked ?? null);
      setNotice("请输入两步验证验证码完成登录。");
      return;
    }
    await completeAuth();
  };

  const loginMutation = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: handleAuthResult,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.detail : "登录失败"),
  });

  const registerMutation = useMutation({
    mutationFn: () => api.register({ email, password, verify_code: verifyCode || null }),
    onSuccess: handleAuthResult,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.detail : "注册失败"),
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.sendVerifyCode({ email }),
    onSuccess: () => setNotice("验证码已发送，请查看邮箱。"),
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.detail : "验证码发送失败"),
  });

  const twoFactorMutation = useMutation({
    mutationFn: () => api.login2FA({ challenge_id: challengeId ?? "", totp_code: totpCode }),
    onSuccess: completeAuth,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.detail : "两步验证失败"),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (challengeId) {
      twoFactorMutation.mutate();
      return;
    }
    if (mode === "login") {
      loginMutation.mutate();
      return;
    }
    registerMutation.mutate();
  };

  const pending = loginMutation.isPending || registerMutation.isPending || twoFactorMutation.isPending;
  const registrationEnabled = publicSettings?.registration_enabled ?? true;
  const emailVerifyEnabled = publicSettings?.email_verify_enabled ?? false;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-[#060a12] dark:text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-50 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[linear-gradient(to_right,rgba(71,85,105,0.34)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.34)_1px,transparent_1px)] dark:opacity-70" />

      <div className="relative w-full max-w-sm px-6">
        <div className="mb-8">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 shadow-sm shadow-zinc-900/20 dark:border dark:border-violet-400/35 dark:bg-violet-500/18 dark:shadow-violet-950/30">
            <LayoutGrid size={20} className="text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            {publicSettings?.site_name || "ProductFlow"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">
            {publicSettings?.site_subtitle || "使用 sub2api 账号登录后开始生成商品素材。"}
          </p>
        </div>

        {!challengeId ? (
          <div className="mb-4 grid grid-cols-2 rounded-lg border border-zinc-200 bg-white p-1 text-sm font-medium dark:border-slate-700 dark:bg-[#0b1220]">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-md px-3 py-2 ${mode === "login" ? "bg-zinc-900 text-white dark:bg-violet-500" : "text-zinc-500 dark:text-slate-400"}`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              disabled={!registrationEnabled}
              className={`rounded-md px-3 py-2 disabled:opacity-40 ${mode === "register" ? "bg-zinc-900 text-white dark:bg-violet-500" : "text-zinc-500 dark:text-slate-400"}`}
            >
              注册
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {challengeId ? (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
                两步验证码{maskedEmail ? `（${maskedEmail}）` : ""}
              </label>
              <input
                type="text"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
                placeholder="请输入 2FA 验证码"
                autoComplete="one-time-code"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
                  邮箱
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
                  placeholder="请输入密码"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
              {mode === "register" && emailVerifyEnabled ? (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
                    邮箱验证码
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(event) => setVerifyCode(event.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
                      placeholder="验证码"
                      autoComplete="one-time-code"
                    />
                    <button
                      type="button"
                      onClick={() => verifyMutation.mutate()}
                      disabled={verifyMutation.isPending || !email}
                      className="rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                    >
                      发送
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {error ? <div className="text-xs font-medium text-red-500 dark:text-red-300">{error}</div> : null}
          {notice ? <div className="text-xs font-medium text-emerald-600 dark:text-emerald-300">{notice}</div> : null}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/35"
          >
            {challengeId ? "完成验证" : mode === "login" ? "登录" : "注册"} <ArrowRight size={14} className="ml-2 opacity-70" />
          </button>
        </form>
      </div>
    </div>
  );
}
