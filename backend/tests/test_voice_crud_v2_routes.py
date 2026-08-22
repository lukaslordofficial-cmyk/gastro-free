"""voice_crud_v2_routes — smoke mount / surface."""
from __future__ import annotations

import inspect

import voice_crud_v2_routes


def test_voice_dispatch_v2_exported():
    assert callable(voice_crud_v2_routes.voice_dispatch_v2)


def test_voice_dispatch_v2_is_async():
    assert inspect.iscoroutinefunction(voice_crud_v2_routes.voice_dispatch_v2)


def test_bulk_helpers_present():
    assert callable(voice_crud_v2_routes._exec_bulk_delete_menu)
    assert callable(voice_crud_v2_routes._exec_scale_recipe)
