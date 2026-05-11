import { Download, Sparkles } from "lucide-react";

import { formatDateTime } from "../../lib/format";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import type { PosterVariant, ProductDetail, SourceAsset } from "../../lib/types";
import { buildPosterDownload, buildSourceImageDownload } from "./imageDownloads";

export function DownloadLink({
  image,
  variant = "button",
}: {
  image: DownloadableImage;
  variant?: "button" | "overlay";
}) {
  const { t } = useI18n();
  const className =
    variant === "overlay"
      ? "absolute bottom-2 right-2 inline-flex items-center rounded bg-white/95 px-2 py-1 text-[10px] font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white dark:bg-slate-950/88 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-900"
      : "inline-flex items-center rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300 dark:hover:border-violet-400/50 dark:hover:bg-violet-500/12 dark:hover:text-white";
  return (
    <a
      data-node-action
      href={image.downloadUrl}
      download={image.filename}
      onClick={(event) => event.stopPropagation()}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={t("detail.downloadImage", { filename: image.filename })}
      aria-label={t("detail.downloadImage", { filename: image.filename })}
    >
      <Download size={11} className="mr-1" /> {t("detail.download")}
    </a>
  );
}

export function PosterThumb({
  poster,
  productName,
  onPreview,
  onUseAsReference,
  useAsReferenceDisabled = false,
  useAsReferenceBusy = false,
}: {
  poster: PosterVariant;
  productName: string;
  onPreview?: (image: DownloadableImage) => void;
  onUseAsReference?: () => void;
  useAsReferenceDisabled?: boolean;
  useAsReferenceBusy?: boolean;
}) {
  const { t } = useI18n();
  const image = buildPosterDownload(productName, poster, undefined, t);
  const thumbnailImage = buildPosterDownload(productName, poster, poster.thumbnail_url, t);
  return (
    <div className="group overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-slate-700/80 dark:bg-[#151f33]">
      <button
        type="button"
        onClick={() => onPreview?.(image)}
        className="block w-full"
        aria-label={t("detail.previewImage", { alt: image.alt })}
      >
        <div className="aspect-square bg-zinc-100 dark:bg-[#0b1220]">
          <img
            src={thumbnailImage.previewUrl}
            alt={image.alt}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:border-slate-700 dark:text-slate-400">
        <span className="min-w-0 truncate">
          {poster.kind === "main_image" ? t("detail.mainImage") : t("detail.promoImage")} ·{" "}
          {formatDateTime(poster.created_at)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onUseAsReference ? (
            <button
              data-node-action
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUseAsReference();
              }}
              disabled={useAsReferenceDisabled || useAsReferenceBusy}
              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:border-violet-300 dark:hover:bg-violet-500/22"
              title={t("detail.fillCurrentNode")}
            >
              {useAsReferenceBusy ? t("detail.filling") : t("detail.fill")}
            </button>
          ) : null}
          <DownloadLink image={image} />
        </div>
      </div>
    </div>
  );
}

export function SourceAssetThumb({
  asset,
  product,
  onPreview,
  onUseAsReference,
  useAsReferenceDisabled = false,
  useAsReferenceBusy = false,
}: {
  asset: SourceAsset;
  product: ProductDetail;
  onPreview?: (image: DownloadableImage) => void;
  onUseAsReference?: () => void;
  useAsReferenceDisabled?: boolean;
  useAsReferenceBusy?: boolean;
}) {
  const { t } = useI18n();
  const image = buildSourceImageDownload(
    product,
    asset,
    asset.kind === "original_image" ? t("detail.mainImage") : t("detail.referenceImage"),
    undefined,
    t,
  );
  const thumbnailImage = buildSourceImageDownload(
    product,
    asset,
    asset.kind === "original_image" ? t("detail.mainImage") : t("detail.referenceImage"),
    asset.thumbnail_url,
    t,
  );
  return (
    <div className="group overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-slate-700/80 dark:bg-[#151f33]">
      <button
        type="button"
        onClick={() => onPreview?.(image)}
        className="block w-full"
        aria-label={t("detail.previewImage", { alt: image.alt })}
      >
        <div className="flex aspect-square items-center justify-center bg-zinc-100 p-2 dark:bg-[#0b1220]">
          <img
            src={thumbnailImage.previewUrl}
            alt={image.alt}
            className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
          />
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:border-slate-700 dark:text-slate-400">
        <span className="min-w-0 truncate">
          {t("detail.referenceImage")} · {formatDateTime(asset.created_at)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onUseAsReference ? (
            <button
              data-node-action
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUseAsReference();
              }}
              disabled={useAsReferenceDisabled || useAsReferenceBusy}
              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:border-violet-300 dark:hover:bg-violet-500/22"
              title={t("detail.fillCurrentNode")}
            >
              {useAsReferenceBusy ? t("detail.filling") : t("detail.fill")}
            </button>
          ) : null}
          <DownloadLink image={image} />
        </div>
      </div>
      {onUseAsReference ? (
        <div className="flex items-center border-t border-zinc-100 px-2 py-1.5 text-[10px] leading-4 text-zinc-500 dark:border-slate-700 dark:text-slate-300">
          <Sparkles size={11} className="mr-1 shrink-0 text-indigo-500 dark:text-violet-300" />
          {t("detail.canUseAsReference")}
        </div>
      ) : null}
    </div>
  );
}
