import { describe, expect, it } from "vitest";

import { configValuesFromChangedDrafts, draftsFromConfig } from "./SettingsPage";
import type { ConfigItem, ConfigResponse } from "../lib/types";

function configItem(overrides: Partial<ConfigItem> & Pick<ConfigItem, "key" | "value">): ConfigItem {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    category: overrides.category ?? "测试",
    input_type: overrides.input_type ?? "text",
    description: overrides.description ?? "",
    value: overrides.value,
    source: overrides.source ?? "env_default",
    secret: overrides.secret ?? false,
    has_value: overrides.has_value ?? false,
    options: overrides.options ?? [],
    minimum: overrides.minimum ?? null,
    maximum: overrides.maximum ?? null,
    updated_at: overrides.updated_at ?? null,
  };
}

function configResponse(items: ConfigItem[]): ConfigResponse {
  return { items };
}

describe("SettingsPage draft helpers", () => {
  it("only submits changed non-secret values instead of rewriting the whole config page", () => {
    const items = [
      configItem({ key: "admin_access_required", input_type: "boolean", value: true }),
      configItem({ key: "image_main_image_size", value: "1024x1024" }),
      configItem({ key: "image_tool_allowed_fields", input_type: "multi_select", value: ["model", "quality"] }),
    ];
    const state = draftsFromConfig(configResponse(items));

    const values = configValuesFromChangedDrafts(
      items,
      {
        ...state.drafts,
        image_main_image_size: "1536x1024",
      },
      state.snapshots,
      {},
    );

    expect(values).toEqual({ image_main_image_size: "1536x1024" });
  });

  it("keeps untouched secrets out but submits touched secrets", () => {
    const items = [
      configItem({ key: "local_secret", input_type: "password", secret: true, has_value: true, value: "" }),
    ];
    const state = draftsFromConfig(configResponse(items));

    expect(configValuesFromChangedDrafts(items, state.drafts, state.snapshots, {})).toEqual({});
    expect(
      configValuesFromChangedDrafts(
        items,
        { ...state.drafts, local_secret: "sk-new" },
        state.snapshots,
        { local_secret: true },
      ),
    ).toEqual({ local_secret: "sk-new" });
  });

  it("detects multi-select changes by ordered option values", () => {
    const items = [configItem({ key: "image_tool_allowed_fields", input_type: "multi_select", value: ["model"] })];
    const state = draftsFromConfig(configResponse(items));

    const unchanged = configValuesFromChangedDrafts(items, state.drafts, state.snapshots, {});
    const changed = configValuesFromChangedDrafts(
      items,
      { image_tool_allowed_fields: ["model", "quality"] },
      state.snapshots,
      {},
    );

    expect(unchanged).toEqual({});
    expect(changed).toEqual({ image_tool_allowed_fields: ["model", "quality"] });
  });
});
