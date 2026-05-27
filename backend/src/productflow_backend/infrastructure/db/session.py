from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from productflow_backend.config import get_settings


def _normalize_database_url(url: str) -> str:
    """Rewrite legacy psycopg2 dialect indicators to the modern psycopg v3 driver.

    Railway's Postgres template emits URLs with either the bare ``postgresql://``
    scheme (which SQLAlchemy resolves via the psycopg2 default) or the explicit
    ``postgresql+psycopg2://`` dialect.  Both must be rewritten to
    ``postgresql+psycopg://`` so SQLAlchemy uses the installed psycopg v3 package
    (``psycopg[binary]``) instead of the legacy psycopg2 package.
    """
    if url.startswith("postgresql+psycopg2://"):
        return url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


@lru_cache(maxsize=1)
def get_engine():
    settings = get_settings()
    database_url = _normalize_database_url(settings.database_url)
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(
        database_url,
        future=True,
        connect_args=connect_args,
        pool_pre_ping=True,
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False)


def get_db_session() -> Generator[Session, None, None]:
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
