"""add sub2api multi user foundation

Revision ID: 20260515_0029
Revises: 20260513_0028
Create Date: 2026-05-15
"""

from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import op

revision = "20260515_0029"
down_revision = "20260513_0028"
branch_labels = None
depends_on = None

ROOT_TABLES = ("products", "image_sessions", "user_canvas_templates", "image_gallery_entries")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    default_owner = os.environ.get("MIGRATION_DEFAULT_OWNER_ID", "").strip()
    implicit_sqlite_owner = not default_owner and bind.dialect.name == "sqlite"
    if implicit_sqlite_owner:
        default_owner = "dev:admin"
    _preflight(bind, tables, default_owner, implicit_sqlite_owner)

    if "user_provider_credentials" not in tables:
        op.create_table(
            "user_provider_credentials",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_id", sa.String(length=120), nullable=False),
            sa.Column("sub2api_user_id", sa.String(length=120), nullable=False),
            sa.Column("api_key_id", sa.String(length=120), nullable=True),
            sa.Column("encrypted_api_key", sa.Text(), nullable=False),
            sa.Column("fingerprint", sa.String(length=80), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_user_provider_credentials_owner_id", "user_provider_credentials", ["owner_id"])
        op.create_index("ix_user_provider_credentials_api_key_id", "user_provider_credentials", ["api_key_id"])

    if "auth_sessions" not in tables:
        op.create_table(
            "auth_sessions",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("owner_id", sa.String(length=120), nullable=False),
            sa.Column("sub2api_user_id", sa.String(length=120), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("username", sa.String(length=255), nullable=True),
            sa.Column("role", sa.String(length=40), nullable=False),
            sa.Column("encrypted_access_token", sa.Text(), nullable=True),
            sa.Column("credential_id", sa.String(length=36), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("settings_unlocked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("ip_address", sa.String(length=80), nullable=True),
            sa.ForeignKeyConstraint(["credential_id"], ["user_provider_credentials.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_auth_sessions_owner_id", "auth_sessions", ["owner_id"])
        op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])

    if "auth_login_challenges" not in tables:
        op.create_table(
            "auth_login_challenges",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("encrypted_temp_token", sa.Text(), nullable=False),
            sa.Column("email_masked", sa.String(length=255), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("failed_attempts", sa.Integer(), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_auth_login_challenges_expires_at", "auth_login_challenges", ["expires_at"])

    for table in ("products", "image_sessions", "user_canvas_templates", "image_gallery_entries"):
        if table in tables:
            _add_owner_column(bind, inspector, table, default_owner)

    if "user_canvas_templates" in tables:
        _repair_user_canvas_template_indexes(bind)

    if "image_session_generation_tasks" in tables:
        columns = _columns(inspector, "image_session_generation_tasks")
        if "owner_id" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("owner_id", sa.String(length=120), nullable=True))
        if "sub2api_user_id" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("sub2api_user_id", sa.String(length=120), nullable=True))
        if "credential_id" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("credential_id", sa.String(length=36), nullable=True))
        if "provider_base_url" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("provider_base_url", sa.Text(), nullable=True))
        if "provider_key_fingerprint" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("provider_key_fingerprint", sa.String(length=80), nullable=True))
        bind.execute(
            sa.text(
                "update image_session_generation_tasks set owner_id = "
                "(select owner_id from image_sessions where image_sessions.id = image_session_generation_tasks.session_id) "
                "where owner_id is null"
            )
        )
        if default_owner:
            bind.execute(
                sa.text("update image_session_generation_tasks set owner_id = :owner where owner_id is null"),
                {"owner": default_owner},
            )
        with op.batch_alter_table("image_session_generation_tasks") as batch:
            batch.alter_column("owner_id", existing_type=sa.String(length=120), nullable=False)
            batch.create_foreign_key(
                "fk_image_session_generation_tasks_credential_id",
                "user_provider_credentials",
                ["credential_id"],
                ["id"],
                ondelete="SET NULL",
            )
        op.create_index(
            "ix_image_session_generation_tasks_owner_status",
            "image_session_generation_tasks",
            ["owner_id", "status"],
        )

    if "workflow_runs" in tables:
        columns = _columns(inspector, "workflow_runs")
        if "owner_id" not in columns:
            op.add_column("workflow_runs", sa.Column("owner_id", sa.String(length=120), nullable=True))
        if "sub2api_user_id" not in columns:
            op.add_column("workflow_runs", sa.Column("sub2api_user_id", sa.String(length=120), nullable=True))
        if "credential_id" not in columns:
            op.add_column("workflow_runs", sa.Column("credential_id", sa.String(length=36), nullable=True))
        if "provider_base_url" not in columns:
            op.add_column("workflow_runs", sa.Column("provider_base_url", sa.Text(), nullable=True))
        if "provider_key_fingerprint" not in columns:
            op.add_column("workflow_runs", sa.Column("provider_key_fingerprint", sa.String(length=80), nullable=True))
        bind.execute(
            sa.text(
                "update workflow_runs set owner_id = "
                "(select products.owner_id from product_workflows "
                "join products on products.id = product_workflows.product_id "
                "where product_workflows.id = workflow_runs.workflow_id) "
                "where owner_id is null"
            )
        )
        if default_owner:
            bind.execute(
                sa.text("update workflow_runs set owner_id = :owner where owner_id is null"),
                {"owner": default_owner},
            )
        with op.batch_alter_table("workflow_runs") as batch:
            batch.alter_column("owner_id", existing_type=sa.String(length=120), nullable=False)
            batch.create_foreign_key(
                "fk_workflow_runs_credential_id",
                "user_provider_credentials",
                ["credential_id"],
                ["id"],
                ondelete="SET NULL",
            )
        op.create_index("ix_workflow_runs_owner_status", "workflow_runs", ["owner_id", "status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "workflow_runs" in tables:
        _drop_index_if_exists(inspector, "workflow_runs", "ix_workflow_runs_owner_status")
        with op.batch_alter_table("workflow_runs") as batch:
            if _has_foreign_key(inspector, "workflow_runs", "fk_workflow_runs_credential_id"):
                batch.drop_constraint("fk_workflow_runs_credential_id", type_="foreignkey")
            for column in (
                "provider_key_fingerprint",
                "provider_base_url",
                "credential_id",
                "sub2api_user_id",
                "owner_id",
            ):
                if column in _columns(inspector, "workflow_runs"):
                    batch.drop_column(column)

    if "image_session_generation_tasks" in tables:
        _drop_index_if_exists(inspector, "image_session_generation_tasks", "ix_image_session_generation_tasks_owner_status")
        with op.batch_alter_table("image_session_generation_tasks") as batch:
            if _has_foreign_key(
                inspector,
                "image_session_generation_tasks",
                "fk_image_session_generation_tasks_credential_id",
            ):
                batch.drop_constraint("fk_image_session_generation_tasks_credential_id", type_="foreignkey")
            for column in (
                "provider_key_fingerprint",
                "provider_base_url",
                "credential_id",
                "sub2api_user_id",
                "owner_id",
            ):
                if column in _columns(inspector, "image_session_generation_tasks"):
                    batch.drop_column(column)

    for table, index_name in (
        ("image_gallery_entries", "ix_image_gallery_entries_owner_created"),
        ("image_sessions", "ix_image_sessions_owner_updated"),
        ("products", "ix_products_owner_created"),
    ):
        if table in tables:
            _drop_index_if_exists(inspector, table, index_name)
            if "owner_id" in _columns(inspector, table):
                with op.batch_alter_table(table) as batch:
                    batch.drop_column("owner_id")

    if "user_canvas_templates" in tables:
        _drop_index_if_exists(inspector, "user_canvas_templates", "ix_user_canvas_templates_owner_archived")
        _drop_index_if_exists(inspector, "user_canvas_templates", "uq_user_canvas_templates_owner_key")
        if "ix_user_canvas_templates_archived_at" not in {index["name"] for index in inspector.get_indexes("user_canvas_templates")}:
            op.create_index("ix_user_canvas_templates_archived_at", "user_canvas_templates", ["archived_at"])
        with op.batch_alter_table("user_canvas_templates") as batch:
            if "owner_id" in _columns(inspector, "user_canvas_templates"):
                batch.drop_column("owner_id")
            batch.create_unique_constraint("uq_user_canvas_templates_key", ["key"])

    if "auth_sessions" in tables:
        op.drop_table("auth_sessions")
    if "auth_login_challenges" in tables:
        op.drop_table("auth_login_challenges")
    if "user_provider_credentials" in tables:
        op.drop_table("user_provider_credentials")


def _preflight(bind, tables: set[str], default_owner: str, implicit_sqlite_owner: bool = False) -> None:
    legacy_rows = 0
    for table in ROOT_TABLES:
        if table in tables and "owner_id" not in _columns(sa.inspect(bind), table):
            legacy_rows += bind.execute(sa.text(f"select count(*) from {table}")).scalar_one()
    if legacy_rows and not default_owner:
        raise RuntimeError("MIGRATION_DEFAULT_OWNER_ID=sub2api:{admin_user_id} is required before multi-user migration")
    if default_owner and not implicit_sqlite_owner and not default_owner.startswith("sub2api:"):
        raise RuntimeError("MIGRATION_DEFAULT_OWNER_ID must start with sub2api:")

    if "user_canvas_templates" in tables and default_owner:
        duplicates = bind.execute(
            sa.text(
                "select key, count(*) as count from user_canvas_templates group by key having count(*) > 1"
            )
        ).mappings().all()
        if duplicates:
            raise RuntimeError("Duplicate user_canvas_templates.key values must be resolved before owner migration")


def _add_owner_column(bind, inspector, table: str, default_owner: str) -> None:
    columns = _columns(inspector, table)
    if "owner_id" not in columns:
        op.add_column(table, sa.Column("owner_id", sa.String(length=120), nullable=True))
    if default_owner:
        bind.execute(sa.text(f"update {table} set owner_id = :owner where owner_id is null"), {"owner": default_owner})
    with op.batch_alter_table(table) as batch:
        batch.alter_column("owner_id", existing_type=sa.String(length=120), nullable=False)

    if table == "products":
        op.create_index("ix_products_owner_created", table, ["owner_id", "created_at"])
    elif table == "image_sessions":
        op.create_index("ix_image_sessions_owner_updated", table, ["owner_id", "updated_at"])
    elif table == "image_gallery_entries":
        op.create_index("ix_image_gallery_entries_owner_created", table, ["owner_id", "created_at"])


def _repair_user_canvas_template_indexes(bind) -> None:
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("user_canvas_templates")}
    if "ix_user_canvas_templates_archived_at" in indexes:
        op.drop_index("ix_user_canvas_templates_archived_at", table_name="user_canvas_templates")
    constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("user_canvas_templates")}
    if None in constraints:
        with op.batch_alter_table(
            "user_canvas_templates",
            naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"},
        ) as batch:
            batch.drop_constraint("uq_user_canvas_templates_key", type_="unique")
    for name in constraints:
        if name and name != "uq_user_canvas_templates_owner_key":
            with op.batch_alter_table("user_canvas_templates") as batch:
                batch.drop_constraint(name, type_="unique")
    op.create_index("ix_user_canvas_templates_owner_archived", "user_canvas_templates", ["owner_id", "archived_at"])
    op.create_index("uq_user_canvas_templates_owner_key", "user_canvas_templates", ["owner_id", "key"], unique=True)


def _drop_index_if_exists(inspector, table: str, name: str) -> None:
    if name in {index["name"] for index in inspector.get_indexes(table)}:
        op.drop_index(name, table_name=table)


def _has_foreign_key(inspector, table: str, name: str) -> bool:
    return name in {foreign_key["name"] for foreign_key in inspector.get_foreign_keys(table)}


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}
