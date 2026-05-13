"""OpenAI Images API provider (/v1/images/generations, /v1/images/edits).

Supports any OpenAI-compatible image generation endpoint (DALL-E, SD WebUI, ComfyUI wrappers, etc.).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from openai import OpenAI

from productflow_backend.application.contracts import PosterGenerationInput
from productflow_backend.config import get_runtime_settings
from productflow_backend.domain.enums import PosterKind
from productflow_backend.infrastructure.image.base import (
    GeneratedImagePayload,
    ImageProvider,
    decode_b64_image,
    image_dimensions_from_bytes,
    parse_size,
)
from productflow_backend.infrastructure.prompts import render_prompt_template

logger = logging.getLogger(__name__)

PROVIDER_REQUEST_FAILURE_MESSAGE = "图片供应商请求失败，请检查供应商配置后重试"
PROVIDER_MISSING_OUTPUT_MESSAGE = "图片供应商没有返回图片结果，请稍后重试"


@dataclass(slots=True)
class ImagesAPIResult:
    bytes_data: bytes
    mime_type: str
    model_name: str
    size: str
    generated_at: datetime
    revised_prompt: str | None
    provider_request_json: dict[str, Any]


def _mime_type_from_image_bytes(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


class OpenAIImagesClient:
    """Thin wrapper around the OpenAI Images API (generations + edits)."""

    provider_name = "openai-images"

    def __init__(self) -> None:
        settings = get_runtime_settings()
        self.api_key = settings.image_api_key
        self.base_url = settings.image_base_url
        self.model = settings.image_generate_model
        self.quality = settings.image_images_quality
        self.style = settings.image_images_style

    def _client(self) -> OpenAI:
        if not self.api_key:
            raise RuntimeError("图片供应商缺少 IMAGE_API_KEY")
        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def generate(
        self,
        *,
        prompt: str,
        size: str,
        model: str | None = None,
        quality: str | None = None,
        style: str | None = None,
        n: int = 1,
    ) -> list[ImagesAPIResult]:
        client = self._client()
        req_model = model or self.model
        req_quality = quality or self.quality
        req_style = style or self.style

        request_params: dict[str, Any] = {
            "model": req_model,
            "prompt": prompt,
            "size": size,
            "n": n,
            "response_format": "b64_json",
        }
        if req_quality:
            request_params["quality"] = req_quality
        if req_style:
            request_params["style"] = req_style

        try:
            response = client.images.generate(**request_params)
        except Exception as exc:  # noqa: BLE001
            logger.error("OpenAI Images API generate 失败: %s", exc, exc_info=True)
            raise RuntimeError(PROVIDER_REQUEST_FAILURE_MESSAGE) from exc

        results: list[ImagesAPIResult] = []
        now = datetime.now(UTC)
        for item in response.data:
            b64 = item.b64_json
            if not b64:
                continue
            image_bytes = decode_b64_image(b64)
            results.append(
                ImagesAPIResult(
                    bytes_data=image_bytes,
                    mime_type=_mime_type_from_image_bytes(image_bytes),
                    model_name=req_model,
                    size=size,
                    generated_at=now,
                    revised_prompt=item.revised_prompt,
                    provider_request_json={k: v for k, v in request_params.items() if k != "response_format"},
                )
            )

        if not results:
            raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE)
        return results

    def edit(
        self,
        *,
        image: bytes,
        prompt: str,
        size: str,
        mask: bytes | None = None,
        model: str | None = None,
        n: int = 1,
    ) -> list[ImagesAPIResult]:
        client = self._client()
        req_model = model or self.model

        image_file = BytesIO(image)
        image_file.name = "image.png"

        request_params: dict[str, Any] = {
            "model": req_model,
            "image": image_file,
            "prompt": prompt,
            "size": size,
            "n": n,
            "response_format": "b64_json",
        }
        if mask is not None:
            mask_file = BytesIO(mask)
            mask_file.name = "mask.png"
            request_params["mask"] = mask_file

        log_params = {k: v for k, v in request_params.items() if k not in {"image", "mask", "response_format"}}
        log_params["has_mask"] = mask is not None

        try:
            response = client.images.edit(**request_params)
        except Exception as exc:  # noqa: BLE001
            logger.error("OpenAI Images API edit 失败: %s", exc, exc_info=True)
            raise RuntimeError(PROVIDER_REQUEST_FAILURE_MESSAGE) from exc

        results: list[ImagesAPIResult] = []
        now = datetime.now(UTC)
        for item in response.data:
            b64 = item.b64_json
            if not b64:
                continue
            image_bytes = decode_b64_image(b64)
            results.append(
                ImagesAPIResult(
                    bytes_data=image_bytes,
                    mime_type=_mime_type_from_image_bytes(image_bytes),
                    model_name=req_model,
                    size=size,
                    generated_at=now,
                    revised_prompt=item.revised_prompt,
                    provider_request_json=log_params,
                )
            )

        if not results:
            raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE)
        return results


class OpenAIImagesImageProvider(ImageProvider):
    """ImageProvider implementation backed by the standard OpenAI Images API."""

    provider_name = "openai-images"
    prompt_version = "images-api-v1"

    def generate_poster_image(
        self,
        poster: PosterGenerationInput,
        kind: PosterKind,
    ) -> tuple[GeneratedImagePayload, str]:
        settings = get_runtime_settings()
        client = OpenAIImagesClient()

        size = poster.image_size or (
            settings.image_main_image_size if kind == PosterKind.MAIN_IMAGE else settings.image_promo_poster_size
        )
        prompt = self._build_prompt(poster, kind, settings)

        if poster.source_image is not None:
            source_bytes = poster.source_image.resolve().read_bytes()
            results = client.edit(image=source_bytes, prompt=prompt, size=size)
        else:
            results = client.generate(prompt=prompt, size=size)

        result = results[0]
        width, height = parse_size(size)
        dims = image_dimensions_from_bytes(result.bytes_data)
        if dims:
            width, height = dims

        payload = GeneratedImagePayload(
            kind=kind,
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            width=width,
            height=height,
            variant_label="v1",
        )
        return payload, result.model_name

    def _build_prompt(self, poster: PosterGenerationInput, kind: PosterKind, settings: Any) -> str:
        context_parts: list[str] = []
        context_parts.append(f"商品名称：{poster.product_name}")
        if poster.category:
            context_parts.append(f"类目：{poster.category}")
        if poster.price:
            context_parts.append(f"价格：{poster.price}")
        if poster.structured_copy_context:
            context_parts.append(f"文案上下文：{poster.structured_copy_context}")

        context_block = "\n".join(context_parts)
        instruction = poster.instruction or "生成商品海报图片"

        kind_requirements = ""
        if kind == PosterKind.MAIN_IMAGE:
            kind_requirements = "这是商品主图，需要突出商品本身，背景简洁。"
        elif kind == PosterKind.PROMO_POSTER:
            kind_requirements = "这是促销海报，可以包含文字排版和促销信息。"

        reference_policy = settings.prompt_poster_image_reference_policy
        template = settings.prompt_poster_image_template

        return render_prompt_template(
            template,
            {
                "instruction": instruction,
                "size": poster.image_size or "1024x1024",
                "context_block": context_block,
                "reference_policy": reference_policy,
                "kind_requirements": kind_requirements,
            },
        )
