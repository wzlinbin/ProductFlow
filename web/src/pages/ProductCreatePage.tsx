import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, Tag, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ImageDropZone } from "../components/ImageDropZone";
import { api, ApiError } from "../lib/api";
import type { CanvasTemplateSummary, WorkflowNodeType } from "../lib/types";

interface PreviewNode {
  id: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  width?: number;
  tone?: "input" | "copy" | "image" | "output" | "blank";
}

interface PreviewEdge {
  from: string;
  to: string;
}

interface CanvasPlanOption {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  badge: string;
  stage: string;
  outputCount: number;
  referenceCount: number;
  previewNodes: PreviewNode[];
  previewEdges: PreviewEdge[];
}

const BLANK_CANVAS_PLAN: CanvasPlanOption = {
  key: "",
  label: "空白画布",
  shortLabel: "自由编排",
  description: "只保留商品资料入口，适合从零搭建流程。",
  badge: "基础",
  stage: "blank",
  outputCount: 0,
  referenceCount: 0,
  previewNodes: [
    { id: "product", title: "商品资料", subtitle: "商品信息", x: 48, y: 112, tone: "input" },
    { id: "blank", title: "自由编排", subtitle: "添加节点", x: 368, y: 112, tone: "blank" },
  ],
  previewEdges: [{ from: "product", to: "blank" }],
};

const PREVIEW_MIN_WIDTH = 920;
const PREVIEW_NODE_WIDTH = 248;
const NODE_HEIGHT = 74;

const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  product_context: "商品资料",
  reference_image: "参考图",
  copy_generation: "文案",
  image_generation: "图片生成",
};

const stageLabels: Record<string, string> = {
  blank: "空白",
  listing: "平台首图",
  detail: "详情说服",
  content: "内容种草",
  gallery: "场景图册",
  campaign: "活动投放",
};

const stageOrder = ["blank", "listing", "detail", "gallery", "content", "campaign"];

const toneClasses: Record<NonNullable<PreviewNode["tone"]>, string> = {
  input: "border-sky-100 bg-sky-50/90 text-sky-900",
  copy: "border-violet-100 bg-violet-50/90 text-violet-900",
  image: "border-emerald-100 bg-emerald-50/90 text-emerald-900",
  output: "border-amber-100 bg-amber-50/90 text-amber-900",
  blank: "border-dashed border-zinc-300 bg-white/80 text-zinc-500",
};

function nodeTone(nodeType: WorkflowNodeType, outputNodeKeys: Set<string>, nodeKey: string): PreviewNode["tone"] {
  if (nodeType === "product_context") {
    return "input";
  }
  if (nodeType === "copy_generation") {
    return "copy";
  }
  if (nodeType === "image_generation") {
    return "image";
  }
  return outputNodeKeys.has(nodeKey) ? "output" : "input";
}

function nodeSubtitle(
  node: CanvasTemplateSummary["preview_nodes"][number],
  outputNodeKeys: Set<string>,
): string {
  if (outputNodeKeys.has(node.key)) {
    return "结果槽位";
  }
  if (node.node_type === "image_generation" && node.size) {
    return node.size.replace("x", " x ");
  }
  return NODE_TYPE_LABELS[node.node_type];
}

function canvasTemplateToPlan(template: CanvasTemplateSummary): CanvasPlanOption {
  const outputNodeKeys = new Set(template.output_slots.map((slot) => slot.node_key));
  return {
    key: template.key,
    label: template.title,
    shortLabel: template.output_slots.map((slot) => slot.label).join(" / ") || template.scenario.title,
    description: template.description,
    badge: template.scenario.title || "模板",
    stage: template.scenario.ecommerce_stage,
    outputCount: template.output_slots.length,
    referenceCount: template.reference_input_hints.length,
    previewNodes: template.preview_nodes.map((node) => ({
      id: node.key,
      title: node.title,
      subtitle: nodeSubtitle(node, outputNodeKeys),
      x: node.position_x,
      y: node.position_y,
      tone: nodeTone(node.node_type, outputNodeKeys, node.key),
    })),
    previewEdges: template.preview_edges.map((edge) => ({
      from: edge.source_node_key,
      to: edge.target_node_key,
    })),
  };
}

function sortPlans(plans: CanvasPlanOption[]): CanvasPlanOption[] {
  return [...plans].sort((left, right) => {
    const leftIndex = stageOrder.indexOf(left.stage);
    const rightIndex = stageOrder.indexOf(right.stage);
    const normalizedLeft = leftIndex === -1 ? stageOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? stageOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.label.localeCompare(right.label, "zh-Hans-CN");
  });
}

function previewWidth(plan: CanvasPlanOption): number {
  if (!plan.previewNodes.length) {
    return PREVIEW_MIN_WIDTH;
  }
  return Math.max(
    PREVIEW_MIN_WIDTH,
    Math.max(...plan.previewNodes.map((node) => node.x + (node.width ?? PREVIEW_NODE_WIDTH))) + 96,
  );
}

function groupedPlans(plans: CanvasPlanOption[]) {
  const groups = new Map<string, CanvasPlanOption[]>();
  for (const plan of plans) {
    const items = groups.get(plan.stage) ?? [];
    items.push(plan);
    groups.set(plan.stage, items);
  }
  return stageOrder
    .filter((stage) => groups.has(stage))
    .map((stage) => ({ stage, label: stageLabels[stage] ?? stage, plans: groups.get(stage) ?? [] }));
}

export function ProductCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [canvasTemplateKey, setCanvasTemplateKey] = useState<string>("");
  const [error, setError] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["canvas-templates"],
    queryFn: () => api.listCanvasTemplates(),
  });

  const canvasPlanOptions = useMemo(() => {
    const fullCanvasTemplates =
      templatesQuery.data?.items
        .filter((template) => template.kind === "full_canvas")
        .map(canvasTemplateToPlan) ?? [];
    return [BLANK_CANVAS_PLAN, ...sortPlans(fullCanvasTemplates)];
  }, [templatesQuery.data]);

  const selectedPlan =
    canvasPlanOptions.find((option) => option.key === canvasTemplateKey) ?? BLANK_CANVAS_PLAN;

  const planGroups = useMemo(() => groupedPlans(canvasPlanOptions), [canvasPlanOptions]);

  const previewLabel = useMemo(() => {
    if (!file) {
      return "点击或拖拽上传";
    }
    return file.name;
  }, [file]);

  const createProductMutation = useMutation({
    mutationFn: () => {
      if (!file) {
        throw new Error("请先上传商品图");
      }
      return api.createProduct({
        name,
        file,
        canvas_template_key: selectedPlan.key,
      });
    },
    onSuccess: (product) => {
      navigate(`/products/${product.id}`);
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError) {
        setError(mutationError.detail);
        return;
      }
      setError(mutationError instanceof Error ? mutationError.message : "创建商品失败");
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    createProductMutation.mutate();
  };

  const handleImageFiles = (files: File[]) => {
    setFile(files[0] ?? null);
    setError("");
  };

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-4 text-zinc-900 sm:px-6 lg:px-8">
      <main className="mx-auto max-w-[1480px]">
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-zinc-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-blue-600">
              <Tag size={21} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">新建商品</h1>
              <p className="mt-1 text-sm text-zinc-500">上传商品图，选择一套可编辑的出图画布</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/products")}
            aria-label="关闭"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200/70 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-900"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-950">商品信息</h2>

            <div className="mt-5">
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                商品主图 <span className="text-red-500">*</span>
              </label>
              <ImageDropZone
                ariaLabel="上传商品主图"
                className="flex aspect-[1.55] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50/40 p-7 text-zinc-500 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                onFiles={handleImageFiles}
              >
                {({ isDragging }) => (
                  <>
                    <ImagePlus size={34} className="mb-3 text-zinc-400" />
                    <p className="text-sm font-medium text-zinc-700">{isDragging ? "松开以上传图片" : previewLabel}</p>
                    <p className="mt-2 text-xs text-zinc-500">支持 JPG / PNG / WebP，最大 5MB</p>
                  </>
                )}
              </ImageDropZone>
            </div>

            <div className="mt-6">
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                商品名称 <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm transition-shadow placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="例如：春季新款复古碎花连衣裙"
              />
              <div className="mt-1 text-right text-xs text-zinc-400">{name.length} / 60</div>
            </div>

            {error ? <div className="mt-4 text-sm text-red-600">{error}</div> : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => navigate("/products")}
                className="flex-1 rounded-md border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createProductMutation.isPending}
                className="flex flex-1 items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {createProductMutation.isPending ? <Loader2 size={15} className="mr-2 animate-spin" /> : null}
                创建并继续
              </button>
            </div>
          </section>

          <section className="grid min-h-[720px] gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">选择模板</h2>
                  <p className="mt-1 text-sm text-zinc-500">按实际出图目标选择</p>
                </div>
                {templatesQuery.isLoading ? <Loader2 size={16} className="animate-spin text-zinc-400" /> : null}
              </div>

              {templatesQuery.isError ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  模板加载失败，仍可创建空白画布
                </div>
              ) : null}

              <div className="mt-4 max-h-[610px] space-y-5 overflow-y-auto pr-1">
                {planGroups.map((group) => (
                  <div key={group.stage}>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">{group.label}</h3>
                      <span className="text-[11px] text-zinc-400">{group.plans.length}</span>
                    </div>
                    <div className="space-y-2">
                      {group.plans.map((option) => {
                        const selected = selectedPlan.key === option.key;
                        return (
                          <button
                            key={option.key || "blank"}
                            type="button"
                            onClick={() => setCanvasTemplateKey(option.key)}
                            className={`w-full rounded-lg border p-3 text-left transition-colors ${
                              selected
                                ? "border-blue-500 bg-blue-50/50 shadow-[0_0_0_1px_rgb(59_130_246)]"
                                : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                            }`}
                          >
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-zinc-950">
                                  {option.label}
                                </span>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                                  {option.description}
                                </p>
                              </div>
                              {selected ? <Check size={14} className="mt-0.5 shrink-0 text-blue-600" /> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <TemplateChip>{option.shortLabel}</TemplateChip>
                              {option.outputCount ? <TemplateChip>{option.outputCount} 输出</TemplateChip> : null}
                              {option.referenceCount ? <TemplateChip>{option.referenceCount} 参考</TemplateChip> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-zinc-950">{selectedPlan.label}</h2>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                      {selectedPlan.badge}
                    </span>
                  </div>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">{selectedPlan.description}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                    {selectedPlan.previewNodes.length} 节点
                  </span>
                  <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                    {selectedPlan.previewEdges.length} 连线
                  </span>
                </div>
              </div>
              <WorkflowPreview plan={selectedPlan} />
            </div>
          </section>
        </form>
      </main>
    </div>
  );
}

function TemplateChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
      {children}
    </span>
  );
}

function WorkflowPreview({ plan }: { plan: CanvasPlanOption }) {
  const nodeById = new Map(plan.previewNodes.map((node) => [node.id, node]));
  const width = previewWidth(plan);
  return (
    <div className="relative h-[560px] overflow-x-auto overflow-y-hidden rounded-md border border-zinc-100 bg-zinc-50">
      <div
        className="relative h-full bg-[radial-gradient(circle_at_1px_1px,rgb(212_212_216)_1px,transparent_0)] bg-[length:16px_16px]"
        style={{ width }}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} 560`} aria-hidden="true">
          {plan.previewEdges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) {
              return null;
            }
            const fromWidth = from.width ?? PREVIEW_NODE_WIDTH;
            const startX = from.x + fromWidth;
            const startY = from.y + NODE_HEIGHT / 2;
            const endX = to.x;
            const endY = to.y + NODE_HEIGHT / 2;
            const midX = startX + Math.max((endX - startX) / 2, 36);
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                fill="none"
                stroke="#4f46e5"
                strokeLinecap="round"
                strokeOpacity="0.75"
                strokeWidth="1.8"
              />
            );
          })}
        </svg>
        {plan.previewNodes.map((node) => (
          <PreviewNodeCard key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}

function PreviewNodeCard({ node }: { node: PreviewNode }) {
  const width = node.width ?? PREVIEW_NODE_WIDTH;
  const status = node.tone === "copy" || node.tone === "image" ? "待运行" : "可用";
  return (
    <div
      className={`absolute rounded-lg border px-3 py-3 shadow-sm backdrop-blur ${toneClasses[node.tone ?? "input"]}`}
      style={{ left: node.x, top: node.y, width, minHeight: NODE_HEIGHT }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{node.title}</div>
          <div className="mt-1 truncate text-xs opacity-70">{node.subtitle}</div>
        </div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-zinc-500">{status}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        <span className="h-1.5 w-7 rounded-full bg-current opacity-20" />
        <span className="h-1.5 w-4 rounded-full bg-current opacity-20" />
      </div>
    </div>
  );
}
