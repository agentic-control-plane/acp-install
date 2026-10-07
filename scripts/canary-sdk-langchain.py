#!/usr/bin/env python3
"""SDK canary: acp-langchain (PyPI, latest). Proves the adapter installs and
imports with its LangChain dependency, that ACPMiddleware() constructs, and
makes one governed tool-call check through the protocol it re-exports. The
middleware's own wrap hooks are not driven here (that needs a model run)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp_langchain  # noqa: E402

from canary_sdk_common import run  # noqa: E402


def adapter_check() -> None:
    mw = acp_langchain.ACPMiddleware()
    print(f"ok   acp_langchain.ACPMiddleware constructed ({type(mw).__name__})")


run("langchain", acp_langchain, adapter_check)
