from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from productflow_backend.config import get_settings
from productflow_backend.application.product_workflows import (
    apply_node_group_template_to_workflow,
    archive_user_canvas_template,
    bind_workflow_node_image,
    cancel_product_workflow_run,
    create_user_canvas_template_from_workflow_nodes,
    create_workflow_edge,
    create_workflow_node,
    delete_workflow_edge,
    delete_workflow_node,
    get_or_create_product_workflow,
    get_product_workflow_status,
    list_canvas_templates,
    rename_user_canvas_template,
    retry_product_workflow_run,
    submit_product_workflow_run,
    update_workflow_copy_set,
    update_workflow_node,
    upload_workflow_node_image,
)
from productflow_backend.presentation.deps import CurrentUser, get_session, require_user
from productflow_backend.presentation.schemas.product_workflows import (
    ApplyWorkflowTemplateGroupRequest,
    BindWorkflowNodeImageRequest,
    CanvasTemplateListResponse,
    CanvasTemplateSummaryResponse,
    CreateUserTemplateGroupRequest,
    CreateWorkflowEdgeRequest,
    CreateWorkflowNodeRequest,
    ProductWorkflowResponse,
    ProductWorkflowStatusResponse,
    RunWorkflowRequest,
    UpdateUserTemplateGroupRequest,
    UpdateWorkflowCopySetRequest,
    UpdateWorkflowNodeRequest,
    serialize_canvas_template_summary,
    serialize_product_workflow,
    serialize_product_workflow_status,
    serialize_user_canvas_template_summary,
)
from productflow_backend.presentation.upload_validation import read_validated_image_upload

router = APIRouter(prefix="/api", tags=["product-workflows"], dependencies=[Depends(require_user)])


@router.get("/products/{product_id}/workflow", response_model=ProductWorkflowResponse)
def get_product_workflow_endpoint(
    product_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = get_or_create_product_workflow(session, product_id, current_user.owner_id)
    return serialize_product_workflow(workflow)


@router.get("/products/{product_id}/workflow/status", response_model=ProductWorkflowStatusResponse)
def get_product_workflow_status_endpoint(
    product_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowStatusResponse:
    workflow = get_product_workflow_status(session, product_id, current_user.owner_id)
    return serialize_product_workflow_status(workflow)


@router.get("/workflow/canvas-templates", response_model=CanvasTemplateListResponse)
def list_canvas_templates_endpoint(
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> CanvasTemplateListResponse:
    templates = [serialize_canvas_template_summary(template) for template in list_canvas_templates(session, current_user.owner_id)]
    return CanvasTemplateListResponse(items=templates)


@router.post(
    "/products/{product_id}/workflow/user-template-groups",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_template_group_endpoint(
    product_id: str,
    payload: CreateUserTemplateGroupRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> CanvasTemplateSummaryResponse:
    template = create_user_canvas_template_from_workflow_nodes(
        session,
        owner_id=current_user.owner_id,
        product_id=product_id,
        title=payload.title,
        description=payload.description,
        node_ids=payload.node_ids,
    )
    return serialize_user_canvas_template_summary(template)


@router.patch("/workflow/user-template-groups/{template_id}", response_model=CanvasTemplateSummaryResponse)
def update_user_template_group_endpoint(
    template_id: str,
    payload: UpdateUserTemplateGroupRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> CanvasTemplateSummaryResponse:
    template = rename_user_canvas_template(
        session,
        owner_id=current_user.owner_id,
        template_id=template_id,
        title=payload.title,
        description=payload.description,
    )
    return serialize_user_canvas_template_summary(template)


@router.delete("/workflow/user-template-groups/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_user_template_group_endpoint(
    template_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> None:
    archive_user_canvas_template(session, owner_id=current_user.owner_id, template_id=template_id)


@router.post(
    "/products/{product_id}/workflow/nodes",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_node_endpoint(
    product_id: str,
    payload: CreateWorkflowNodeRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = create_workflow_node(
        session,
        owner_id=current_user.owner_id,
        product_id=product_id,
        node_type=payload.node_type,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/template-groups",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def apply_workflow_template_group_endpoint(
    product_id: str,
    payload: ApplyWorkflowTemplateGroupRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = apply_node_group_template_to_workflow(
        session,
        owner_id=current_user.owner_id,
        product_id=product_id,
        template_key=payload.template_key,
        position_x=payload.position_x,
        position_y=payload.position_y,
    )
    return serialize_product_workflow(workflow)


@router.patch("/workflow-nodes/{node_id}", response_model=ProductWorkflowResponse)
def update_workflow_node_endpoint(
    node_id: str,
    payload: UpdateWorkflowNodeRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = update_workflow_node(
        session,
        owner_id=current_user.owner_id,
        node_id=node_id,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return serialize_product_workflow(workflow)


@router.patch("/workflow-nodes/{node_id}/copy", response_model=ProductWorkflowResponse)
def update_workflow_copy_set_endpoint(
    node_id: str,
    payload: UpdateWorkflowCopySetRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = update_workflow_copy_set(
        session,
        owner_id=current_user.owner_id,
        node_id=node_id,
        structured_payload=payload.structured_payload,
    )
    return serialize_product_workflow(workflow)


@router.post("/workflow-nodes/{node_id}/image", response_model=ProductWorkflowResponse)
async def upload_workflow_node_image_endpoint(
    node_id: str,
    image: UploadFile = File(...),
    role: str | None = Form(default=None),
    label: str | None = Form(default=None),
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    validated = await read_validated_image_upload(image, fallback_filename="workflow-image.bin")
    workflow = upload_workflow_node_image(
        session,
        owner_id=current_user.owner_id,
        node_id=node_id,
        image_bytes=validated.content,
        filename=validated.filename,
        content_type=validated.mime_type,
        role=role,
        label=label,
    )
    return serialize_product_workflow(workflow)


@router.post("/workflow-nodes/{node_id}/image-source", response_model=ProductWorkflowResponse)
def bind_workflow_node_image_endpoint(
    node_id: str,
    payload: BindWorkflowNodeImageRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = bind_workflow_node_image(
        session,
        owner_id=current_user.owner_id,
        node_id=node_id,
        source_asset_id=payload.source_asset_id,
        poster_variant_id=payload.poster_variant_id,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/edges",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_edge_endpoint(
    product_id: str,
    payload: CreateWorkflowEdgeRequest,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = create_workflow_edge(
        session,
        owner_id=current_user.owner_id,
        product_id=product_id,
        source_node_id=payload.source_node_id,
        target_node_id=payload.target_node_id,
        source_handle=payload.source_handle,
        target_handle=payload.target_handle,
    )
    return serialize_product_workflow(workflow)


@router.delete("/workflow-edges/{edge_id}", response_model=ProductWorkflowResponse)
def delete_workflow_edge_endpoint(
    edge_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = delete_workflow_edge(session, owner_id=current_user.owner_id, edge_id=edge_id)
    return serialize_product_workflow(workflow)


@router.delete("/workflow-nodes/{node_id}", response_model=ProductWorkflowResponse)
def delete_workflow_node_endpoint(
    node_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = delete_workflow_node(session, owner_id=current_user.owner_id, node_id=node_id)
    return serialize_product_workflow(workflow)


@router.post("/products/{product_id}/workflow/run", response_model=ProductWorkflowResponse)
def run_product_workflow_endpoint(
    product_id: str,
    payload: RunWorkflowRequest | None = None,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    if not current_user.credential_id and not current_user.is_admin:
        raise HTTPException(status_code=409, detail={"code": "API_KEY_UNAVAILABLE", "message": "当前账号暂无可用 API Key"})
    workflow = submit_product_workflow_run(
        session,
        owner_id=current_user.owner_id,
        sub2api_user_id=current_user.sub2api_user_id,
        credential_id=current_user.credential_id,
        provider_base_url=get_settings().sub2api_provider_base_url,
        provider_key_fingerprint=current_user.provider_key_fingerprint,
        product_id=product_id,
        start_node_id=payload.start_node_id if payload else None,
    )
    return serialize_product_workflow(workflow)


@router.post("/products/{product_id}/workflow/runs/{run_id}/cancel", response_model=ProductWorkflowResponse)
def cancel_product_workflow_run_endpoint(
    product_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    workflow = cancel_product_workflow_run(
        session,
        owner_id=current_user.owner_id,
        product_id=product_id,
        run_id=run_id,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/runs/{run_id}/retry",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_product_workflow_run_endpoint(
    product_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(require_user),
    session: Session = Depends(get_session),
) -> ProductWorkflowResponse:
    if not current_user.credential_id and not current_user.is_admin:
        raise HTTPException(status_code=409, detail={"code": "API_KEY_UNAVAILABLE", "message": "当前账号暂无可用 API Key"})
    workflow = retry_product_workflow_run(
        session,
        owner_id=current_user.owner_id,
        sub2api_user_id=current_user.sub2api_user_id,
        credential_id=current_user.credential_id,
        provider_base_url=get_settings().sub2api_provider_base_url,
        provider_key_fingerprint=current_user.provider_key_fingerprint,
        product_id=product_id,
        run_id=run_id,
    )
    return serialize_product_workflow(workflow)
