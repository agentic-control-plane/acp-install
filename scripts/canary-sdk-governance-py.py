#!/usr/bin/env python3
"""SDK canary: acp-governance (PyPI, latest). One governed tool-call check."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp_governance  # noqa: E402

from canary_sdk_common import run  # noqa: E402

run("governance-py", acp_governance)
