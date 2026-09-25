from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class APIModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class SuccessEnvelope(APIModel, Generic[T]):
    success: Literal[True] = True
    data: T
    meta: dict[str, Any] | None = None


class ErrorBody(APIModel):
    code: str
    message: str
    details: Any | None = None


class ErrorEnvelope(APIModel):
    success: Literal[False] = False
    error: ErrorBody
    meta: dict[str, Any] | None = None


class PageMeta(APIModel):
    total: int = Field(ge=0)
    limit: int = Field(gt=0)
    offset: int = Field(ge=0)


class MessageData(APIModel):
    message: str
