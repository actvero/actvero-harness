"""SDK transport projection of the native Web workbench recording."""
import json
import sys
from pathlib import Path

from deepseek_harness import HarnessClient, HarnessConfig


def test_workbench_object_survives_stdio_notification_projection(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    recording = root / "snapshots/web/actvero-workbench-object/session.v4.jsonl"
    bindings = [event for line in recording.read_text(encoding="utf-8").splitlines()
                if (event := json.loads(line))["type"] == "actvero/workbench"]
    expected = json.loads((Path(__file__).parent / "expected/workbench-object-projection.json").read_text(encoding="utf-8"))
    assert len(bindings) == 1
    script = tmp_path / "recorded_peer.py"
    script.write_text("""
import json
import os
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message["method"] == "initialize":
        result = {"serverInfo": {"name": "recorded-peer"}}
    elif message["method"] == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {}}), flush=True)
        break
    else:
        raise RuntimeError("Unexpected protocol method")
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
    for seq, event in enumerate(json.loads(os.environ["WORKBENCH_EVENTS"])):
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {
            "sessionId": "workbench-object", "event": {**event, "seq": seq, "time": 0}}}), flush=True)
""".strip(), encoding="utf-8")
    config = HarnessConfig(env={"WORKBENCH_EVENTS": json.dumps(bindings)})
    with HarnessClient(config, _launch_args=(sys.executable, str(script))) as client:
        client.initialize(cwd=str(tmp_path), provider="fixture", model="fixture")
        projected = []
        for _ in bindings:
            notification = client.next_notification()
            assert notification.method == "session.event"
            assert notification.payload["sessionId"] == "workbench-object"
            event = notification.payload["event"]
            projected.append({"type": event["type"], "data": event["data"]})
    assert projected == expected
