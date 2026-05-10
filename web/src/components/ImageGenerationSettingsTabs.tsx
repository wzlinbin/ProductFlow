import type { ReactNode } from "react";

import { useI18n } from "../lib/preferences";

export type ImageGenerationSettingsTab = "basic" | "advanced";

interface ImageGenerationSettingsTabsProps {
  value: ImageGenerationSettingsTab;
  onChange: (value: ImageGenerationSettingsTab) => void;
  basic: ReactNode;
  advanced: ReactNode;
  className?: string;
}

export function ImageGenerationSettingsTabs({
  value,
  onChange,
  basic,
  advanced,
  className = "",
}: ImageGenerationSettingsTabsProps) {
  const { t } = useI18n();
  const tabs: readonly [ImageGenerationSettingsTab, string][] = [
    ["basic", t("imageSettings.tabs.basic")],
    ["advanced", t("imageSettings.tabs.advanced")],
  ];

  return (
    <div className={className}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950/70">
        {tabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={`h-9 rounded-lg border text-sm font-semibold transition-colors ${
              value === tab
                ? "border-indigo-200 bg-white text-indigo-700 shadow-sm dark:border-indigo-400/60 dark:bg-indigo-500/20 dark:text-indigo-100 dark:ring-1 dark:ring-indigo-400/25"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {value === "basic" ? basic : advanced}
    </div>
  );
}
