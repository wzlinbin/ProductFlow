import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  CheckCircle2,
  Image,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  Save,
  Search,
  ServerCog,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SelectField } from "../components/SelectField";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import type {
  ConfigItem,
  ConfigResponse,
  ProviderBinding,
  ProviderCapability,
  ProviderConfigResponse,
  ProviderProfile,
} from "../lib/types";

type DraftValue = string | boolean | string[];
type SettingsSectionId = "providers" | "text" | "image" | "prompts" | "upload" | "queue" | "security";

interface DraftSnapshot {
  value: DraftValue;
}

interface ConfigDraftState {
  drafts: Record<string, DraftValue>;
  snapshots: Record<string, DraftSnapshot>;
}

interface SettingsSection {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  groupKey: TranslationKey;
  icon: LucideIcon;
}

interface ProviderProfileFormState {
  name: string;
  base_url: string;
  api_key: string;
  capabilities: ProviderCapability[];
  enabled: boolean;
}

interface TextBindingDraft {
  provider_kind: "mock" | "openai";
  provider_profile_id: string;
  brief_model: string;
  copy_model: string;
}

interface ImageBindingDraft {
  provider_kind: "mock" | "openai_responses" | "openai_images";
  provider_profile_id: string;
  model: string;
  images_quality: string;
  images_style: string;
  responses_background_enabled: boolean;
}

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-sm shadow-slate-200/35 focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-indigo-500 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:shadow-black/20 " +
  "dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";

const TEXTAREA_CLASS =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-sm shadow-slate-200/35 focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] " +
  "dark:text-slate-100 dark:shadow-black/20 dark:placeholder:text-slate-500 dark:focus:border-violet-400";

const PANEL_CLASS =
  "rounded-xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";

const SETTINGS_MAIN_ACTION_CLASS =
  "inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white " +
  "shadow-sm shadow-indigo-500/25 hover:bg-indigo-500 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400";

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "providers",
    labelKey: "settings.section.providers",
    descriptionKey: "settings.section.providersDescription",
    groupKey: "settings.groupProviders",
    icon: ServerCog,
  },
  {
    id: "text",
    labelKey: "settings.section.text",
    descriptionKey: "settings.section.textDescription",
    groupKey: "settings.groupProviders",
    icon: MessageSquareText,
  },
  {
    id: "image",
    labelKey: "settings.section.image",
    descriptionKey: "settings.section.imageDescription",
    groupKey: "settings.groupProviders",
    icon: Image,
  },
  {
    id: "prompts",
    labelKey: "settings.section.prompts",
    descriptionKey: "settings.section.promptsDescription",
    groupKey: "settings.groupWorkflow",
    icon: SlidersHorizontal,
  },
  {
    id: "upload",
    labelKey: "settings.section.upload",
    descriptionKey: "settings.section.uploadDescription",
    groupKey: "settings.groupWorkflow",
    icon: UploadCloud,
  },
  {
    id: "queue",
    labelKey: "settings.section.queue",
    descriptionKey: "settings.section.queueDescription",
    groupKey: "settings.groupWorkflow",
    icon: SettingsIcon,
  },
  {
    id: "security",
    labelKey: "settings.section.security",
    descriptionKey: "settings.section.securityDescription",
    groupKey: "settings.groupSecurity",
    icon: ShieldCheck,
  },
];

const SETTINGS_GROUPS: TranslationKey[] = ["settings.groupProviders", "settings.groupWorkflow", "settings.groupSecurity"];

const PROVIDER_CAPABILITY_OPTIONS: Array<{ value: ProviderCapability; labelKey: TranslationKey }> = [
  { value: "text_responses", labelKey: "settings.provider.capability.textResponses" },
  { value: "image_responses", labelKey: "settings.provider.capability.imageResponses" },
  { value: "image_images", labelKey: "settings.provider.capability.imageImages" },
];

function providerCapabilityLabelKey(capability: ProviderCapability): TranslationKey {
  return (
    PROVIDER_CAPABILITY_OPTIONS.find((option) => option.value === capability)?.labelKey ??
    "settings.provider.capability.imageImages"
  );
}

const EMPTY_PROVIDER_FORM: ProviderProfileFormState = {
  name: "",
  base_url: "",
  api_key: "",
  capabilities: ["text_responses", "image_images"],
  enabled: true,
};

function multiSelectValue(value: ConfigItem["value"]): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function draftFromItem(item: ConfigItem): DraftValue {
  if (item.input_type === "boolean") {
    return Boolean(item.value);
  }
  if (item.input_type === "multi_select") {
    return multiSelectValue(item.value);
  }
  if (item.secret) {
    return "";
  }
  return item.value === null || item.value === undefined ? "" : String(item.value);
}

function draftValuesEqual(a: DraftValue, b: DraftValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }
  return a === b;
}

export function draftsFromConfig(config: ConfigResponse): ConfigDraftState {
  const nextDrafts: Record<string, DraftValue> = {};
  const snapshots: Record<string, DraftSnapshot> = {};
  for (const item of config.items) {
    const value = draftFromItem(item);
    nextDrafts[item.key] = value;
    snapshots[item.key] = { value };
  }
  return { drafts: nextDrafts, snapshots };
}

export function configValuesFromChangedDrafts(
  items: ConfigItem[],
  drafts: Record<string, DraftValue>,
  snapshots: Record<string, DraftSnapshot>,
  secretTouched: Record<string, boolean>,
): Record<string, string | number | boolean | string[] | null> {
  const values: Record<string, string | number | boolean | string[] | null> = {};
  for (const item of items) {
    if (item.secret && !secretTouched[item.key]) {
      continue;
    }
    const snapshot = snapshots[item.key];
    const nextValue = drafts[item.key] ?? "";
    if (snapshot && draftValuesEqual(nextValue, snapshot.value)) {
      continue;
    }
    values[item.key] = nextValue;
  }
  return values;
}

function sourceLabel(item: ConfigItem, t: ReturnType<typeof useI18n>["t"]): string {
  return item.source === "database" ? t("settings.database") : t("settings.envDefault");
}

function sourceClassName(item: ConfigItem): string {
  if (item.source === "database") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-slate-700 dark:bg-[#0b1220]";
}

function textValue(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function boolValue(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function providerFormFromProfile(profile?: ProviderProfile | null): ProviderProfileFormState {
  if (!profile) {
    return EMPTY_PROVIDER_FORM;
  }
  return {
    name: profile.name,
    base_url: profile.base_url ?? "",
    api_key: "",
    capabilities: profile.capabilities,
    enabled: profile.enabled,
  };
}

function getBinding(data: ProviderConfigResponse | undefined, purpose: "text" | "image"): ProviderBinding | undefined {
  return data?.bindings.find((binding) => binding.purpose === purpose);
}

function textBindingDraft(binding: ProviderBinding | undefined): TextBindingDraft {
  return {
    provider_kind: binding?.provider_kind === "openai" ? "openai" : "mock",
    provider_profile_id: binding?.provider_profile_id ?? "",
    brief_model: textValue(binding?.model_settings, "brief_model"),
    copy_model: textValue(binding?.model_settings, "copy_model"),
  };
}

function imageBindingDraft(binding: ProviderBinding | undefined): ImageBindingDraft {
  const providerKind =
    binding?.provider_kind === "openai_responses" || binding?.provider_kind === "openai_images"
      ? binding.provider_kind
      : "mock";
  return {
    provider_kind: providerKind,
    provider_profile_id: binding?.provider_profile_id ?? "",
    model: textValue(binding?.model_settings, "model"),
    images_quality: textValue(binding?.config, "images_quality"),
    images_style: textValue(binding?.config, "images_style"),
    responses_background_enabled: boolValue(binding?.config, "responses_background_enabled", true),
  };
}

function itemsForSection(config: ConfigResponse | undefined, section: SettingsSectionId): ConfigItem[] {
  const items = config?.items ?? [];
  if (section === "prompts") {
    return items.filter((item) => item.category === "提示词");
  }
  if (section === "upload") {
    return items.filter((item) => item.category === "海报与上传" || item.category === "图片工具参数");
  }
  if (section === "queue") {
    return items.filter((item) => item.category === "生成队列");
  }
  if (section === "security") {
    return items.filter((item) => item.category === "安全与运维");
  }
  return [];
}

interface SettingsFormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

function SettingsFormField({ label, children, className = "" }: SettingsFormFieldProps) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

interface ConfigFieldProps {
  item: ConfigItem;
  value: DraftValue;
  secretTouched: boolean;
  isResetting: boolean;
  onChange: (value: DraftValue, touchedSecret?: boolean) => void;
  onReset: () => void;
}

function ConfigField({ item, value, secretTouched, isResetting, onChange, onReset }: ConfigFieldProps) {
  const { t } = useI18n();
  const selectedMultiValues = Array.isArray(value) ? value : [];
  const toggleMultiValue = (optionValue: string) => {
    const selected = new Set(selectedMultiValues);
    if (selected.has(optionValue)) {
      selected.delete(optionValue);
    } else {
      selected.add(optionValue);
    }
    onChange(item.options.filter((option) => selected.has(option.value)).map((option) => option.value));
  };

  const control =
    item.input_type === "multi_select" ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {item.options.map((option) => (
          <label
            key={`${item.key}-${option.value}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300"
          >
            <input
              type="checkbox"
              checked={selectedMultiValues.includes(option.value)}
              onChange={() => toggleMultiValue(option.value)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    ) : item.input_type === "select" ? (
      <SelectField id={item.key} value={String(value)} options={item.options} onChange={onChange} />
    ) : item.input_type === "textarea" ? (
      <textarea
        id={item.key}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        rows={item.key.startsWith("prompt_") ? 8 : 3}
        className={`${TEXTAREA_CLASS} resize-y leading-6`}
      />
    ) : item.input_type === "boolean" ? (
      <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300">
        <input
          id={item.key}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-zinc-900"
        />
        <span>{Boolean(value) ? t("settings.enabled") : t("settings.disabled")}</span>
      </label>
    ) : (
      <input
        id={item.key}
        type={item.input_type === "password" ? "password" : item.input_type === "number" ? "number" : "text"}
        value={String(value)}
        min={item.minimum ?? undefined}
        max={item.maximum ?? undefined}
        placeholder={item.secret && item.has_value ? t("settings.secretPlaceholder") : item.description || undefined}
        onChange={(event) => onChange(event.target.value, item.secret)}
        className={INPUT_CLASS}
        autoComplete={item.secret ? "new-password" : undefined}
      />
    );

  return (
    <div className="grid gap-3 border-t border-slate-100 py-5 first:border-t-0 dark:border-slate-800 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={item.key} className="text-sm font-medium text-zinc-900 dark:text-white">
            {item.label}
          </label>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(item)}`}>
            {sourceLabel(item, t)}
          </span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-slate-500">{item.key}</div>
      </div>
      <div className="space-y-2">
        {control}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-h-4 text-xs leading-5 text-zinc-500 dark:text-slate-400">
            {item.description}
            {item.secret && secretTouched ? (
              <span className="ml-2 text-amber-600 dark:text-amber-300">{t("settings.writeNewSecret")}</span>
            ) : null}
          </p>
          {item.source === "database" ? (
            <button
              type="button"
              onClick={onReset}
              disabled={isResetting}
              className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
            >
              {isResetting ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RotateCcw size={13} className="mr-1" />}
              {t("settings.restoreDefault")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ProvidersSectionProps {
  data: ProviderConfigResponse | undefined;
  profileForm: ProviderProfileFormState;
  editingProfileId: string | null;
  pending: boolean;
  onProfileFormChange: (next: ProviderProfileFormState) => void;
  onEditProfile: (profile: ProviderProfile) => void;
  onCancelEdit: () => void;
  onSubmitProfile: () => void;
  onArchiveProfile: (profileId: string) => void;
}

function ProvidersSection({
  data,
  profileForm,
  editingProfileId,
  pending,
  onProfileFormChange,
  onEditProfile,
  onCancelEdit,
  onSubmitProfile,
  onArchiveProfile,
}: ProvidersSectionProps) {
  const { t } = useI18n();
  const profiles = data?.profiles ?? [];
  const toggleCapability = (capability: ProviderCapability) => {
    const selected = new Set(profileForm.capabilities);
    if (selected.has(capability)) {
      selected.delete(capability);
    } else {
      selected.add(capability);
    }
    onProfileFormChange({
      ...profileForm,
      capabilities: PROVIDER_CAPABILITY_OPTIONS.map((option) => option.value).filter((value) => selected.has(value)),
    });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
      <div className={PANEL_CLASS}>
        {profiles.length ? (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/35"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditProfile(profile)}
                        className="truncate text-left text-sm font-semibold text-slate-950 hover:text-indigo-700 dark:text-white dark:hover:text-violet-200"
                      >
                        {profile.name}
                      </button>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300">
                        {profile.enabled ? t("settings.provider.enabled") : t("settings.provider.disabled")}
                      </span>
                      {profile.archived_at ? (
                        <span className="rounded-full border border-amber-200 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-400/40 dark:text-amber-200">
                          {t("settings.provider.archived")}
                        </span>
                      ) : null}
                      {profile.has_api_key ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200">
                          {t("settings.provider.keyConfigured")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                      {profile.base_url || t("settings.provider.defaultBaseUrl")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {profile.capabilities.map((capability) => (
                        <span
                          key={`${profile.id}-${capability}`}
                          className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {t(providerCapabilityLabelKey(capability))}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onArchiveProfile(profile.id)}
                    disabled={pending || Boolean(profile.archived_at)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400 dark:hover:border-red-300/50 dark:hover:text-red-200"
                    aria-label={t("settings.provider.archiveAria")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 text-center dark:border-slate-700">
            <Box size={42} className="text-slate-500" />
            <div className="mt-5 text-base font-semibold text-slate-950 dark:text-white">
              {t("settings.provider.emptyTitle")}
            </div>
            <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("settings.provider.emptyDescription")}
            </p>
          </div>
        )}
      </div>

      <div className={PANEL_CLASS}>
        <div className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
          <KeyRound size={16} />
          {editingProfileId ? t("settings.provider.edit") : t("settings.provider.create")}
        </div>
        <div className="space-y-4">
          <SettingsFormField label={t("settings.provider.nameLabel")}>
            <input
              value={profileForm.name}
              onChange={(event) => onProfileFormChange({ ...profileForm, name: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.namePlaceholder")}
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.baseUrlLabel")}>
            <input
              value={profileForm.base_url}
              onChange={(event) => onProfileFormChange({ ...profileForm, base_url: event.target.value })}
              className={`${INPUT_CLASS} font-mono`}
              placeholder="http://localhost:3000/v1"
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.apiKeyLabel")}>
            <input
              type="password"
              value={profileForm.api_key}
              onChange={(event) => onProfileFormChange({ ...profileForm, api_key: event.target.value })}
              className={INPUT_CLASS}
              placeholder={
                editingProfileId
                  ? t("settings.provider.keepKeyPlaceholder")
                  : t("settings.provider.apiKeyPlaceholder")
              }
              autoComplete="new-password"
            />
          </SettingsFormField>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("settings.provider.capabilitiesLabel")}
            </div>
            {PROVIDER_CAPABILITY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={profileForm.capabilities.includes(option.value)}
                  onChange={() => toggleCapability(option.value)}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                <span>{t(option.labelKey)}</span>
              </label>
            ))}
          </div>
          <label className="inline-flex items-center gap-3 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
            <input
              type="checkbox"
              checked={profileForm.enabled}
              onChange={(event) => onProfileFormChange({ ...profileForm, enabled: event.target.checked })}
              className="h-4 w-4 accent-indigo-600"
            />
            {t("settings.provider.enable")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            {editingProfileId ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              >
                {t("common.cancel")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSubmitProfile}
              disabled={pending || !profileForm.name.trim() || !profileForm.capabilities.length}
              className={SETTINGS_MAIN_ACTION_CLASS}
            >
              {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
              {t("detail.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TextBindingSectionProps {
  data: ProviderConfigResponse | undefined;
  draft: TextBindingDraft;
  pending: boolean;
  onChange: (next: TextBindingDraft) => void;
  onSave: () => void;
}

function TextBindingSection({ data, draft, pending, onChange, onSave }: TextBindingSectionProps) {
  const { t } = useI18n();
  const profiles = (data?.profiles ?? []).filter(
    (profile) => profile.enabled && !profile.archived_at && profile.capabilities.includes("text_responses"),
  );
  return (
    <div className={`${PANEL_CLASS} max-w-3xl space-y-5`}>
      <SettingsFormField label={t("settings.provider.apiInterfaceLabel")}>
        <SelectField
          value={draft.provider_kind}
          options={[
            { value: "mock", label: "Mock" },
            { value: "openai", label: "OpenAI Responses" },
          ]}
          onChange={(value) => onChange({ ...draft, provider_kind: value === "openai" ? "openai" : "mock" })}
          radius="lg"
        />
      </SettingsFormField>
      {draft.provider_kind !== "mock" ? (
        <SettingsFormField label={t("settings.provider.compatibleProviderLabel")}>
          <SelectField
            value={draft.provider_profile_id}
            options={[
              { value: "", label: t("settings.provider.selectProfile") },
              ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
            ]}
            onChange={(value) => onChange({ ...draft, provider_profile_id: value })}
            radius="lg"
          />
        </SettingsFormField>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingsFormField label={t("settings.provider.textBriefModelLabel")}>
          <input
            value={draft.brief_model}
            onChange={(event) => onChange({ ...draft, brief_model: event.target.value })}
            className={INPUT_CLASS}
            placeholder={t("settings.provider.textBriefModelPlaceholder")}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.provider.textCopyModelLabel")}>
          <input
            value={draft.copy_model}
            onChange={(event) => onChange({ ...draft, copy_model: event.target.value })}
            className={INPUT_CLASS}
            placeholder={t("settings.provider.textCopyModelPlaceholder")}
          />
        </SettingsFormField>
      </div>
      <div className="flex justify-end border-t border-slate-100 pt-5 dark:border-slate-800">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || (draft.provider_kind !== "mock" && !draft.provider_profile_id)}
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
          {t("settings.provider.saveText")}
        </button>
      </div>
    </div>
  );
}

interface ImageBindingSectionProps {
  data: ProviderConfigResponse | undefined;
  draft: ImageBindingDraft;
  pending: boolean;
  onChange: (next: ImageBindingDraft) => void;
  onSave: () => void;
}

function ImageBindingSection({ data, draft, pending, onChange, onSave }: ImageBindingSectionProps) {
  const { t } = useI18n();
  const requiredCapability = draft.provider_kind === "openai_responses" ? "image_responses" : "image_images";
  const profiles = (data?.profiles ?? []).filter(
    (profile) => profile.enabled && !profile.archived_at && profile.capabilities.includes(requiredCapability),
  );
  return (
    <div className={`${PANEL_CLASS} max-w-3xl space-y-5`}>
      <SettingsFormField label={t("settings.provider.apiInterfaceLabel")}>
        <SelectField
          value={draft.provider_kind}
          options={[
            { value: "mock", label: "Mock" },
            { value: "openai_responses", label: "OpenAI Responses" },
            { value: "openai_images", label: "OpenAI Images API" },
          ]}
          onChange={(value) =>
            onChange({
              ...draft,
              provider_kind:
                value === "openai_responses" || value === "openai_images" ? value : "mock",
              provider_profile_id: "",
            })
          }
          radius="lg"
        />
      </SettingsFormField>
      {draft.provider_kind !== "mock" ? (
        <SettingsFormField label={t("settings.provider.compatibleProviderLabel")}>
          <SelectField
            value={draft.provider_profile_id}
            options={[
              { value: "", label: t("settings.provider.selectProfile") },
              ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
            ]}
            onChange={(value) => onChange({ ...draft, provider_profile_id: value })}
            radius="lg"
          />
        </SettingsFormField>
      ) : null}
      <SettingsFormField label={t("settings.provider.imageModelLabel")}>
        <input
          value={draft.model}
          onChange={(event) => onChange({ ...draft, model: event.target.value })}
          className={INPUT_CLASS}
          placeholder={t("settings.provider.imageModelPlaceholder")}
        />
      </SettingsFormField>
      {draft.provider_kind === "openai_images" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsFormField label={t("settings.provider.imagesQualityLabel")}>
            <input
              value={draft.images_quality}
              onChange={(event) => onChange({ ...draft, images_quality: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesQualityPlaceholder")}
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.imagesStyleLabel")}>
            <input
              value={draft.images_style}
              onChange={(event) => onChange({ ...draft, images_style: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesStylePlaceholder")}
            />
          </SettingsFormField>
        </div>
      ) : null}
      <div className="flex flex-col gap-5 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        {draft.provider_kind === "openai_responses" ? (
          <label className="inline-flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.responses_background_enabled}
              onChange={(event) => onChange({ ...draft, responses_background_enabled: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-slate-600"
            />
            {t("settings.provider.responsesBackground")}
          </label>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={pending || (draft.provider_kind !== "mock" && !draft.provider_profile_id)}
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
          {t("settings.provider.saveImage")}
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [draftSnapshots, setDraftSnapshots] = useState<Record<string, DraftSnapshot>>({});
  const [secretTouched, setSecretTouched] = useState<Record<string, boolean>>({});
  const [resettingKey, setResettingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [unlockToken, setUnlockToken] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("providers");
  const [sectionSearch, setSectionSearch] = useState("");
  const [providerProfileForm, setProviderProfileForm] = useState<ProviderProfileFormState>(EMPTY_PROVIDER_FORM);
  const [editingProviderProfileId, setEditingProviderProfileId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<TextBindingDraft>(textBindingDraft(undefined));
  const [imageDraft, setImageDraft] = useState<ImageBindingDraft>(imageBindingDraft(undefined));

  const lockStateQuery = useQuery({
    queryKey: ["settings-lock-state"],
    queryFn: api.getSettingsLockState,
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
    enabled: Boolean(lockStateQuery.data?.unlocked),
  });

  const providerConfigQuery = useQuery({
    queryKey: ["provider-config"],
    queryFn: api.getProviderConfig,
    enabled: Boolean(lockStateQuery.data?.unlocked),
  });

  const resetDraftsFromConfig = useCallback((config: ConfigResponse | undefined) => {
    if (!config) {
      return;
    }
    const next = draftsFromConfig(config);
    setDrafts(next.drafts);
    setDraftSnapshots(next.snapshots);
    setSecretTouched({});
  }, []);

  useEffect(() => {
    resetDraftsFromConfig(configQuery.data);
  }, [configQuery.data, resetDraftsFromConfig]);

  useEffect(() => {
    setTextDraft(textBindingDraft(getBinding(providerConfigQuery.data, "text")));
    setImageDraft(imageBindingDraft(getBinding(providerConfigQuery.data, "image")));
  }, [providerConfigQuery.data]);

  useEffect(() => {
    if (configQuery.error instanceof ApiError && configQuery.error.status === 403) {
      queryClient.setQueryData(["settings-lock-state"], { unlocked: false, configured: true });
      queryClient.removeQueries({ queryKey: ["config"] });
      queryClient.removeQueries({ queryKey: ["provider-config"] });
    }
  }, [configQuery.error, queryClient]);

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const activeItems = itemsForSection(configQuery.data, activeSection);
  const normalizedSectionSearch = sectionSearch.trim().toLowerCase();
  const visibleSections = normalizedSectionSearch
    ? SETTINGS_SECTIONS.filter(
        (section) =>
          t(section.labelKey).toLowerCase().includes(normalizedSectionSearch) ||
          t(section.descriptionKey).toLowerCase().includes(normalizedSectionSearch),
      )
    : SETTINGS_SECTIONS;

  const saveMutation = useMutation({
    mutationFn: () => {
      const values = configValuesFromChangedDrafts(activeItems, drafts, draftSnapshots, secretTouched);
      return api.updateConfig({ values });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      void queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setError("");
      setSavedMessage(t("settings.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.saveFailed"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) => api.updateConfig({ reset_keys: [key] }),
    onMutate: (key) => {
      setResettingKey(key);
      setError("");
      setSavedMessage("");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      void queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setSavedMessage(t("settings.restored"));
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.restoreFailed"));
    },
    onSettled: () => setResettingKey(null),
  });

  const unlockMutation = useMutation({
    mutationFn: () => api.unlockSettings(unlockToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings-lock-state"], data);
      setUnlockToken("");
      setError("");
      setSavedMessage(t("settings.unlocked"));
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.unlockFailed"));
    },
  });

  const createProviderProfileMutation = useMutation({
    mutationFn: () =>
      api.createProviderProfile({
        name: providerProfileForm.name.trim(),
        base_url: providerProfileForm.base_url.trim() || null,
        api_key: providerProfileForm.api_key.trim() || null,
        capabilities: providerProfileForm.capabilities,
        enabled: providerProfileForm.enabled,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setProviderProfileForm(EMPTY_PROVIDER_FORM);
      setEditingProviderProfileId(null);
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.saveFailed"));
    },
  });

  const updateProviderProfileMutation = useMutation({
    mutationFn: () => {
      if (!editingProviderProfileId) {
        throw new Error(t("settings.provider.missingId"));
      }
      return api.updateProviderProfile(editingProviderProfileId, {
        name: providerProfileForm.name.trim(),
        base_url: providerProfileForm.base_url.trim() || null,
        api_key: providerProfileForm.api_key,
        capabilities: providerProfileForm.capabilities,
        enabled: providerProfileForm.enabled,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setProviderProfileForm(EMPTY_PROVIDER_FORM);
      setEditingProviderProfileId(null);
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.saveFailed"));
    },
  });

  const archiveProviderProfileMutation = useMutation({
    mutationFn: (profileId: string) => api.archiveProviderProfile(profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setError("");
      setSavedMessage(t("settings.provider.archivedMessage"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.archiveFailed"));
    },
  });

  const updateTextBindingMutation = useMutation({
    mutationFn: () =>
      api.updateProviderBinding("text", {
        provider_kind: textDraft.provider_kind,
        provider_profile_id: textDraft.provider_kind === "mock" ? null : textDraft.provider_profile_id,
        model_settings: {
          ...(textDraft.brief_model.trim() ? { brief_model: textDraft.brief_model.trim() } : {}),
          ...(textDraft.copy_model.trim() ? { copy_model: textDraft.copy_model.trim() } : {}),
        },
        config: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setError("");
      setSavedMessage(t("settings.provider.textSaved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.textSaveFailed"));
    },
  });

  const updateImageBindingMutation = useMutation({
    mutationFn: () => {
      const config =
        imageDraft.provider_kind === "openai_responses"
          ? { responses_background_enabled: imageDraft.responses_background_enabled }
          : imageDraft.provider_kind === "openai_images"
            ? {
                ...(imageDraft.images_quality.trim() ? { images_quality: imageDraft.images_quality.trim() } : {}),
                ...(imageDraft.images_style.trim() ? { images_style: imageDraft.images_style.trim() } : {}),
              }
            : {};
      return api.updateProviderBinding("image", {
        provider_kind: imageDraft.provider_kind,
        provider_profile_id: imageDraft.provider_kind === "mock" ? null : imageDraft.provider_profile_id,
        model_settings: imageDraft.model.trim() ? { model: imageDraft.model.trim() } : {},
        config,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setError("");
      setSavedMessage(t("settings.provider.imageSaved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.imageSaveFailed"));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["settings-lock-state"] });
      queryClient.removeQueries({ queryKey: ["config"] });
      queryClient.removeQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSavedMessage("");
    saveMutation.mutate();
  };

  const handleUnlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSavedMessage("");
    unlockMutation.mutate();
  };

  const providerPending =
    createProviderProfileMutation.isPending ||
    updateProviderProfileMutation.isPending ||
    archiveProviderProfileMutation.isPending ||
    updateTextBindingMutation.isPending ||
    updateImageBindingMutation.isPending;

  const isCheckingLockState = lockStateQuery.isLoading || lockStateQuery.isFetching;
  const loadingMain = configQuery.isLoading || providerConfigQuery.isLoading;
  const genericSection = ["prompts", "upload", "queue", "security"].includes(activeSection);
  const isUnlocked = Boolean(lockStateQuery.data?.unlocked);

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-[#060a12] dark:text-slate-100">
      <TopNav
        breadcrumbs={t("settings.breadcrumb")}
        onHome={() => navigate("/products")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1">
        <div className="w-full">
          {!lockStateQuery.data?.unlocked ? (
            <div className="mb-6 flex flex-col gap-3 px-5 py-8 md:flex-row md:items-end md:justify-between lg:px-8 lg:py-10">
              <div>
                <div className="mb-2 inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100">
                  <SettingsIcon size={13} className="mr-1.5" />
                  {t("settings.runtimeConfig")}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                  {t("settings.title")}
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("settings.description")}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/products")}
                className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-slate-400 dark:hover:text-white"
              >
                {t("settings.back")}
              </button>
            </div>
          ) : null}

          {isCheckingLockState ? (
            <div className="flex justify-center py-20 text-zinc-400 dark:text-slate-500">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : lockStateQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {t("settings.lockLoadFailed")}
            </div>
          ) : !lockStateQuery.data?.configured ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              {t("settings.tokenMissing")}
            </div>
          ) : !lockStateQuery.data.unlocked ? (
            <form
              onSubmit={handleUnlock}
              className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-[#0f1726]"
            >
              <div className="mb-5 flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-100">
                  <LockKeyhole size={18} />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                    {t("settings.unlockTitle")}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {t("settings.unlockDescription")}
                  </p>
                </div>
              </div>
              <input
                type="password"
                value={unlockToken}
                onChange={(event) => setUnlockToken(event.target.value)}
                className={INPUT_CLASS}
                placeholder={t("settings.unlockPlaceholder")}
                autoComplete="current-password"
              />
              {error ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  disabled={unlockMutation.isPending || !unlockToken.trim()}
                  className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 dark:bg-violet-500"
                >
                  {unlockMutation.isPending ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <LockKeyhole size={14} className="mr-2" />
                  )}
                  {t("settings.unlock")}
                </button>
              </div>
            </form>
          ) : loadingMain ? (
            <div className="flex justify-center py-20 text-zinc-400 dark:text-slate-500">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : configQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {configQuery.error instanceof ApiError ? configQuery.error.detail : t("settings.loadFailed")}
            </div>
          ) : (
            <div className="grid min-h-full lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-[#0f1726] lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
                <div className="border-b border-slate-200 px-5 py-7 dark:border-slate-800">
                  <div className="flex items-center gap-3 text-lg font-semibold text-slate-950 dark:text-white">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
                      <SettingsIcon size={20} />
                    </span>
                    {t("settings.title")}
                  </div>
                  <label className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 shadow-sm shadow-slate-200/30 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-500 dark:shadow-black/20">
                    <Search size={16} />
                    <input
                      value={sectionSearch}
                      onChange={(event) => setSectionSearch(event.target.value)}
                      placeholder={t("settings.searchPlaceholder")}
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </label>
                </div>
                <nav className="hidden space-y-6 px-3 py-5 lg:block" aria-label={t("settings.navLabel")}>
                  {SETTINGS_GROUPS.map((group) => {
                    const sections = visibleSections.filter((section) => section.groupKey === group);
                    if (!sections.length) {
                      return null;
                    }
                    return (
                      <div key={group}>
                        <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t(group)}
                        </div>
                        <div className="mt-2 space-y-1">
                          {sections.map((section) => {
                            const Icon = section.icon;
                            const active = section.id === activeSection;
                            return (
                              <button
                                key={section.id}
                                type="button"
                                onClick={() => setActiveSection(section.id)}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                                  active
                                    ? "bg-indigo-50 font-semibold text-indigo-700 ring-1 ring-indigo-200 dark:bg-violet-500/18 dark:text-violet-100 dark:ring-violet-400/35"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-violet-500/12 dark:hover:text-white"
                                }`}
                              >
                                <Icon size={15} className={active ? "shrink-0 text-indigo-600 dark:text-violet-200" : "shrink-0 text-slate-400 dark:text-slate-500"} />
                                <span className="truncate">{t(section.labelKey)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </nav>
                <div className="p-4 lg:hidden">
                  <label htmlFor="settings-section" className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("settings.mobileSectionLabel")}
                  </label>
                  <SelectField
                    id="settings-section"
                    value={activeSection}
                    groups={SETTINGS_GROUPS.map((group) => ({
                      label: t(group),
                      options: SETTINGS_SECTIONS.filter((section) => section.groupKey === group).map((section) => ({
                        value: section.id,
                        label: t(section.labelKey),
                      })),
                    }))}
                    onChange={(value) => setActiveSection(value as SettingsSectionId)}
                    radius="lg"
                  />
                </div>
              </aside>

              <section className="min-w-0 bg-white px-5 py-8 dark:bg-[#0b1220] sm:px-8 lg:px-12 lg:py-12">
                <div className="mx-auto max-w-4xl">
                  <div className="mb-10">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                      <span>{t("settings.title")}</span>
                      <span>/</span>
                      <span>{t(activeMeta.labelKey)}</span>
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      {t(activeMeta.labelKey)}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {t(activeMeta.descriptionKey)}
                    </p>
                  </div>
                  {error ? (
                    <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                      {error}
                    </div>
                  ) : null}
                  {savedMessage ? (
                    <div className="mb-5 flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <CheckCircle2 size={16} className="mr-2" />
                      {savedMessage}
                    </div>
                  ) : null}
                  <div>
                    {activeSection === "providers" ? (
                      <ProvidersSection
                        data={providerConfigQuery.data}
                        profileForm={providerProfileForm}
                        editingProfileId={editingProviderProfileId}
                        pending={providerPending}
                        onProfileFormChange={setProviderProfileForm}
                        onEditProfile={(profile) => {
                          setEditingProviderProfileId(profile.id);
                          setProviderProfileForm(providerFormFromProfile(profile));
                          setSavedMessage("");
                        }}
                        onCancelEdit={() => {
                          setEditingProviderProfileId(null);
                          setProviderProfileForm(EMPTY_PROVIDER_FORM);
                        }}
                        onSubmitProfile={() => {
                          setError("");
                          setSavedMessage("");
                          if (editingProviderProfileId) {
                            updateProviderProfileMutation.mutate();
                            return;
                          }
                          createProviderProfileMutation.mutate();
                        }}
                        onArchiveProfile={(profileId) => {
                          setError("");
                          setSavedMessage("");
                          archiveProviderProfileMutation.mutate(profileId);
                        }}
                      />
                    ) : null}

                    {activeSection === "text" ? (
                      <TextBindingSection
                        data={providerConfigQuery.data}
                        draft={textDraft}
                        pending={providerPending}
                        onChange={(next) => {
                          setTextDraft(next);
                          setSavedMessage("");
                        }}
                        onSave={() => {
                          setError("");
                          setSavedMessage("");
                          updateTextBindingMutation.mutate();
                        }}
                      />
                    ) : null}

                    {activeSection === "image" ? (
                      <ImageBindingSection
                        data={providerConfigQuery.data}
                        draft={imageDraft}
                        pending={providerPending}
                        onChange={(next) => {
                          setImageDraft(next);
                          setSavedMessage("");
                        }}
                        onSave={() => {
                          setError("");
                          setSavedMessage("");
                          updateImageBindingMutation.mutate();
                        }}
                      />
                    ) : null}

                    {genericSection ? (
                      <form onSubmit={handleSubmit} className={`${PANEL_CLASS} space-y-2`}>
                        {activeItems.length ? (
                          activeItems.map((item) => (
                            <ConfigField
                              key={item.key}
                              item={item}
                              value={drafts[item.key] ?? draftFromItem(item)}
                              secretTouched={Boolean(secretTouched[item.key])}
                              isResetting={resettingKey === item.key}
                              onChange={(nextValue, touchedSecret) => {
                                setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                                setSavedMessage("");
                                if (touchedSecret) {
                                  setSecretTouched((current) => ({ ...current, [item.key]: true }));
                                }
                              }}
                              onReset={() => resetMutation.mutate(item.key)}
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {t("settings.section.empty")}
                          </div>
                        )}
                        <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => resetDraftsFromConfig(configQuery.data)}
                            className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-slate-300 dark:hover:text-white"
                          >
                            {t("settings.discard")}
                          </button>
                          <button
                            type="submit"
                            disabled={saveMutation.isPending}
                            className={SETTINGS_MAIN_ACTION_CLASS}
                          >
                            {saveMutation.isPending ? (
                              <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                              <Save size={14} className="mr-2" />
                            )}
                            {t("settings.save")}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          )}

          {!isUnlocked && error ? (
            <div className="mx-8 mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          ) : null}
          {!isUnlocked && savedMessage ? (
            <div className="mx-8 mt-5 flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 size={16} className="mr-2" />
              {savedMessage}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
