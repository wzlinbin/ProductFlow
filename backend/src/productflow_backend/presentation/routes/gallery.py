from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from productflow_backend.application.gallery import list_gallery_entries, save_generated_asset_to_gallery
from productflow_backend.presentation.deps import CurrentUser, get_session, require_user
from productflow_backend.presentation.schemas.gallery import (
    GalleryEntryListResponse,
    GalleryEntryResponse,
    SaveGalleryEntryRequest,
    serialize_gallery_entry,
)

router = APIRouter(prefix="/api/gallery", tags=["gallery"], dependencies=[Depends(require_user)])


@router.get("", response_model=GalleryEntryListResponse)
def list_gallery_entries_endpoint(
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> GalleryEntryListResponse:
    items = list_gallery_entries(session, owner_id=current_user.owner_id)
    return GalleryEntryListResponse(items=[serialize_gallery_entry(item) for item in items])


@router.post("", response_model=GalleryEntryResponse, status_code=status.HTTP_201_CREATED)
def save_gallery_entry_endpoint(
    payload: SaveGalleryEntryRequest,
    response: Response,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> GalleryEntryResponse:
    result = save_generated_asset_to_gallery(
        session,
        owner_id=current_user.owner_id,
        image_session_asset_id=payload.image_session_asset_id,
    )
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return serialize_gallery_entry(result.entry)
