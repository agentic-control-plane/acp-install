"""Shared body of the Python SDK canary legs (canary-sdk-<name>.py).

run(name, sdk) makes ONE governed tool-call check against the canary
workspace through the given module's re-exported protocol functions:
set_context(user_token=key) then pre_tool_use("shell", {"command": "echo
<marker>"}). The client header is set per leg (acp-canary-sdk-<name>/<v>)
so canary-assert.mjs can find this leg's audit row among the others running
in the same workspace. A fail-open lapse (reason starts with "fail-open")
means no decision came back and is a FAIL. Env: ACP_CANARY_KEY, MARKER,
ACP_BASE_URL (optional).
"""
from __future__ import annotations

import json
import os
import sys
import time
import warnings


def run(name: str, sdk, adapter_check=None) -> None:
    key = os.environ.get("ACP_CANARY_KEY")
    if not key:
        print("ACP_CANARY_KEY is not set", file=sys.stderr)
        sys.exit(2)
    marker = os.environ.get("MARKER") or f"acp-canary-local-{int(time.time())}"
    version = getattr(sdk, "__version__", "unknown")
    kwargs = {"client_header": f"acp-canary-sdk-{name}/{version}"}
    if os.environ.get("ACP_BASE_URL"):
        kwargs["base_url"] = os.environ["ACP_BASE_URL"]
    sdk.configure(**kwargs)
    if adapter_check is not None:
        adapter_check()
    sdk.set_context(user_token=key, agent_tier="api", agent_name="harness-canary")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        allowed, reason = sdk.pre_tool_use("shell", {"command": f"echo {marker}"})
    print(json.dumps({"sdk": name, "version": version, "allowed": allowed, "reason": reason}))
    lapses = [str(w.message) for w in caught if "UNGOVERNED" in str(w.message)]
    if lapses or reason.startswith("fail-open"):
        print(f"FAIL no decision from the gateway: {lapses or reason}", file=sys.stderr)
        sys.exit(1)
    print(f"ok   {name} got a gateway decision (allowed={allowed}) for shell echo {marker}")
