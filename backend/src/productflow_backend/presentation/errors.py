from __future__ import annotations

from typing import NoReturn

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from productflow_backend.domain.errors import BusinessError


def business_error_to_response(exc: BusinessError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


async def business_error_exception_handler(_: Request, exc: BusinessError) -> JSONResponse:
    return business_error_to_response(exc)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(BusinessError, business_error_exception_handler)


def raise_value_error_as_http(exc: ValueError) -> NoReturn:
    detail = str(exc)
    if isinstance(exc, BusinessError):
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc
    if detail == "海报文件不存在":
        raise HTTPException(status_code=400, detail=detail) from exc
    if detail.endswith("不存在"):
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc
