import { DEFAULT_LOCALE, translate, type TranslationKey, type TranslationParams } from "../../lib/i18n";
import type {
  ProductWorkflow,
  ProductWorkflowStatus,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRun,
} from "../../lib/types";
import { workflowNodeDisplayTitle } from "./nodeDisplay";

type TranslateFunction = (key: TranslationKey, params?: TranslationParams) => string;

const defaultT: TranslateFunction = (key, params) => translate(DEFAULT_LOCALE, key, params);

const NODE_STATUS_LABEL_KEYS: Record<WorkflowNode["status"], TranslationKey> = {
  idle: "detail.nodeStatus.idle",
  queued: "detail.nodeStatus.queued",
  running: "detail.nodeStatus.running",
  succeeded: "detail.nodeStatus.succeeded",
  failed: "detail.nodeStatus.failed",
};

export interface WorkflowNodeRunActionState {
  disabled: boolean;
  pending: boolean;
  label: string;
  title: string;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function outputStringArray(node: WorkflowNode, key: string): string[] {
  const value = node.output_json?.[key] ?? node.config_json[key];
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function configString(
  node: WorkflowNode | null,
  key: string,
  fallback = "",
): string {
  const value = node?.config_json[key];
  return typeof value === "string" ? value : fallback;
}

export function statusClass(status: WorkflowNode["status"]): string {
  return {
    idle: "border-zinc-200 bg-white text-zinc-500 dark:border-slate-600 dark:bg-[#0b1220] dark:text-slate-200",
    queued: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100",
    running: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/40 dark:bg-blue-500/15 dark:text-blue-100",
    succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/50 dark:bg-emerald-400/15 dark:text-emerald-50",
    failed: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-500/15 dark:text-red-100",
  }[status];
}

export function workflowNodeStatusLabel(node: Pick<WorkflowNode, "node_type" | "status">, t: TranslateFunction = defaultT): string {
  if (node.node_type === "product_context" && node.status === "idle") {
    return t("detail.nodeStatus.available");
  }
  return t(NODE_STATUS_LABEL_KEYS[node.status]);
}

export function isImageWorkflowNodeWaiting(node: WorkflowNode): boolean {
  return (
    (node.node_type === "image_generation" || node.node_type === "reference_image") &&
    (node.status === "queued" || node.status === "running")
  );
}

export function imageWorkflowNodeWaitingLabel(node: WorkflowNode, t: TranslateFunction = defaultT): string {
  if (!isImageWorkflowNodeWaiting(node)) {
    return "";
  }
  if (node.node_type === "reference_image") {
    const slotLabel = workflowNodeDisplayTitle(node, t);
    return node.status === "queued"
      ? t("detail.nodeWaiting.referenceQueued", { label: slotLabel })
      : t("detail.nodeWaiting.referenceRunning", { label: slotLabel });
  }
  return node.status === "queued" ? t("detail.nodeWaiting.imageQueued") : t("detail.nodeWaiting.imageRunning");
}

export function getWorkflowNodeRunActionState(
  node: WorkflowNode,
  {
    runSubmissionPending,
    pendingStartNodeId,
  }: {
    runSubmissionPending: boolean;
    pendingStartNodeId: string | null;
  },
  t: TranslateFunction = defaultT,
): WorkflowNodeRunActionState {
  if (node.status === "queued") {
    return {
      disabled: true,
      pending: true,
      label: t("detail.nodeStatus.queued"),
      title: t("detail.runAction.queuedTitle"),
    };
  }
  if (node.status === "running") {
    return {
      disabled: true,
      pending: true,
      label: t("detail.nodeStatus.running"),
      title: t("detail.runAction.runningTitle"),
    };
  }
  if (runSubmissionPending) {
    const pendingThisNode = pendingStartNodeId === node.id || pendingStartNodeId === null;
    return {
      disabled: true,
      pending: pendingThisNode,
      label: pendingThisNode ? t("detail.runAction.submitting") : t("detail.run"),
      title: pendingThisNode ? t("detail.runAction.submittingTitle") : t("detail.runAction.otherSubmittingTitle"),
    };
  }
  return {
    disabled: false,
    pending: false,
    label: node.status === "failed" ? t("detail.retry") : t("detail.run"),
    title: node.status === "failed" ? t("detail.runAction.retryTitle") : t("detail.runAction.runTitle"),
  };
}

export function getWorkflowNodeCancelableRun(
  workflow: ProductWorkflow | undefined | null,
  node: Pick<WorkflowNode, "id"> | undefined | null,
): WorkflowRun | null {
  if (!workflow || !node) {
    return null;
  }
  return (
    workflow.runs.find(
      (run) =>
        run.is_cancelable &&
        run.node_runs.some(
          (nodeRun) =>
            nodeRun.node_id === node.id &&
            (nodeRun.status === "queued" || nodeRun.status === "running"),
        ),
    ) ?? null
  );
}

export function hasActiveWorkflow(workflow: ProductWorkflow | undefined | null): boolean {
  if (!workflow) {
    return false;
  }
  return (
    workflow.runs.some((run) => run.status === "running") ||
    workflow.nodes.some((node) => node.status === "queued" || node.status === "running")
  );
}

export function isProductWorkflowStatusActive(status: ProductWorkflowStatus | undefined | null): boolean {
  if (!status) {
    return false;
  }
  return (
    status.has_active_workflow ||
    status.runs.some((run) => run.status === "running") ||
    status.nodes.some((node) => node.status === "queued" || node.status === "running")
  );
}

export function mergeProductWorkflowStatusIntoDetail(
  workflow: ProductWorkflow,
  status: ProductWorkflowStatus,
): ProductWorkflow {
  if (workflow.id !== status.id) {
    return workflow;
  }
  const nodeStatusById = new Map(status.nodes.map((node) => [node.id, node]));
  const existingRunById = new Map(workflow.runs.map((run) => [run.id, run]));
  const statusRuns = status.runs.map((run): WorkflowRun => {
    const existingRun = existingRunById.get(run.id);
    const existingNodeRunById = new Map((existingRun?.node_runs ?? []).map((nodeRun) => [nodeRun.id, nodeRun]));
    return {
      id: run.id,
      workflow_id: run.workflow_id,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      failure_reason: run.failure_reason,
      is_retryable: run.is_retryable,
      is_cancelable: run.is_cancelable,
      queue_active_count: run.queue_active_count,
      queue_running_count: run.queue_running_count,
      queue_queued_count: run.queue_queued_count,
      queue_max_concurrent_tasks: run.queue_max_concurrent_tasks,
      queued_ahead_count: run.queued_ahead_count,
      queue_position: run.queue_position,
      node_runs: run.node_runs.map((nodeRun): WorkflowNodeRun => {
        const existingNodeRun = existingNodeRunById.get(nodeRun.id);
        return {
          id: nodeRun.id,
          workflow_run_id: nodeRun.workflow_run_id,
          node_id: nodeRun.node_id,
          status: nodeRun.status,
          failure_reason: nodeRun.failure_reason,
          started_at: nodeRun.started_at,
          finished_at: nodeRun.finished_at,
          output_json: existingNodeRun?.output_json ?? null,
          copy_set_id: existingNodeRun?.copy_set_id ?? null,
          poster_variant_id: existingNodeRun?.poster_variant_id ?? null,
          image_session_asset_id: existingNodeRun?.image_session_asset_id ?? null,
        };
      }),
    };
  });
  const statusRunIds = new Set(statusRuns.map((run) => run.id));
  return {
    ...workflow,
    title: status.title,
    active: status.active,
    updated_at: status.updated_at,
    nodes: workflow.nodes.map((node) => {
      const nodeStatus = nodeStatusById.get(node.id);
      if (!nodeStatus) {
        return node;
      }
      return {
        ...node,
        status: nodeStatus.status,
        failure_reason: nodeStatus.failure_reason,
        last_run_at: nodeStatus.last_run_at,
        updated_at: nodeStatus.updated_at,
      };
    }),
    runs: [...statusRuns, ...workflow.runs.filter((run) => !statusRunIds.has(run.id))],
  };
}

export function shouldRefreshProductWorkflowDetailFromStatus(
  workflow: ProductWorkflow | undefined | null,
  status: ProductWorkflowStatus,
): boolean {
  if (!workflow || workflow.id !== status.id) {
    return false;
  }
  if (hasActiveWorkflow(workflow) && !isProductWorkflowStatusActive(status)) {
    return true;
  }
  const latestStatusRun = status.runs[0];
  if (!latestStatusRun || latestStatusRun.status === "running") {
    return false;
  }
  const currentRun = workflow.runs.find((run) => run.id === latestStatusRun.id);
  return !currentRun || currentRun.status !== latestStatusRun.status || currentRun.finished_at !== latestStatusRun.finished_at;
}

export function outputText(
  output: Record<string, unknown>,
  key: string,
): string | null {
  const value = output[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
