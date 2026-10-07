#!/usr/bin/env python3
"""SDK canary: acp-crewai (PyPI, latest). Proves the adapter installs and
imports with its CrewAI dependency, that install_crew_hooks is exported, and
makes one governed tool-call check through the protocol it re-exports. The
crew hooks themselves are not driven here (that needs a crew kickoff)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp_crewai  # noqa: E402

from canary_sdk_common import run  # noqa: E402


def adapter_check() -> None:
    assert callable(acp_crewai.install_crew_hooks), "install_crew_hooks is not exported"
    print("ok   acp_crewai.install_crew_hooks exported")


run("crewai", acp_crewai, adapter_check)
