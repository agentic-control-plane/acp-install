#!/usr/bin/env python3
"""SDK canary: acp-pydantic-ai (PyPI, latest). Proves the adapter installs and
imports with its Pydantic AI dependency, that ACPHooks() constructs, and
makes one governed tool-call check through the protocol it re-exports. The
hooks' own tool_execute wrap is not driven here (that needs a model run)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp_pydantic_ai  # noqa: E402

from canary_sdk_common import run  # noqa: E402


def adapter_check() -> None:
    hooks = acp_pydantic_ai.ACPHooks()
    print(f"ok   acp_pydantic_ai.ACPHooks constructed ({type(hooks).__name__})")


run("pydantic-ai", acp_pydantic_ai, adapter_check)
