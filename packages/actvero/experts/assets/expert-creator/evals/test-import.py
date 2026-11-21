"""用目标桌面的导入器对样例及错误包做隔离回归。用法见 references/import.md。"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

SKILL = Path(__file__).resolve().parents[1]
PACK = SKILL / "scripts/pack-expert.py"
CHECK = SKILL / "scripts/check-import.mjs"


def run_check(path, runtime, expected, code):
    result = subprocess.run(["node", str(CHECK), str(path), *runtime], capture_output=True, text=True)
    try:
        report = json.loads(result.stdout)
    except ValueError:
        raise RuntimeError(result.stderr or result.stdout)
    if result.returncode != code or report["status"] != expected:
        raise AssertionError((path.name, result.returncode, report))
    return report


def pack(source, destination):
    subprocess.run([sys.executable, str(PACK), str(source), str(destination)], check=True, stdout=subprocess.PIPE)


def put_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def exercise(directory, runtime):
    src = directory / "source"
    shutil.copytree(SKILL / "examples/release-notes/package", src)
    entry = src / "skills/release-brief/SKILL.md"
    entry.with_name("SKILL.md.in").rename(entry)
    valid = directory / "release-notes.zip"
    pack(src, valid)
    shipped = SKILL / "examples/release-notes/release-notes-1.0.0.zip"
    with ZipFile(valid) as rebuilt, ZipFile(shipped) as sample:
        assert set(rebuilt.namelist()) == set(sample.namelist())
        assert all(rebuilt.read(name) == sample.read(name) for name in rebuilt.namelist())
    digest = hashlib.sha256(valid.read_bytes()).hexdigest()
    valid_report = run_check(valid, runtime, "imported", 0)
    assert valid_report["expert"]["version"] == "1.0.0"
    assert valid_report["expert"]["revision"] == 1
    assert {row["key"]: row["status"] for row in valid_report["preview"]["rows"]} == {
        "release-brief": "install", "github-repos": "install",
    }
    assert valid_report["dependencies"]["ready"] and valid_report["dependencies"]["warnings"]
    assert hashlib.sha256(valid.read_bytes()).hexdigest() == digest
    print("通过：含多文件 Skill 与可选 MCP 的 ZIP 能导入、回读，原件未改动。")

    manifest = src / "expert.json"
    standalone = run_check(manifest, runtime, "imported", 0)
    assert not standalone["dependencies"]["ready"] and standalone["dependencies"]["missing"]
    print("通过：裸清单能导入，同时明确缺少必需 Skill。")

    assert standalone["expert"]["hasAvatar"] is False
    with_picture = directory / "expert-with-avatar.json"
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rCkAAAAASUVORK5CYII="
    put_json(with_picture, {**json.loads(manifest.read_text()), "avatar": png})
    assert run_check(with_picture, runtime, "imported", 0)["expert"]["hasAvatar"] is True
    print("通过：默认头像与自带 PNG 的专家导入后能回读两种头像状态。")

    wrapped = directory / "cli-request.json"
    put_json(wrapped, {"expert": {"manifest": json.loads(manifest.read_text()), "bindings": {}}})
    assert run_check(wrapped, runtime, "rejected", 1)["stage"] == "manifest"
    print("通过：桌面导入器拒绝误用 CLI 请求外壳。")

    damaged = directory / "damaged.zip"
    with ZipFile(valid) as original, ZipFile(damaged, "w") as altered:
        for member in original.namelist():
            data = original.read(member)
            if member == "expert.json":
                data += b" "
            altered.writestr(member, data)
    assert run_check(damaged, runtime, "rejected", 1)["error"] == "expert_package_checksum"
    print("通过：修改字节后未重建摘要的 ZIP 被拒绝。")

    skill_text = entry.read_text(encoding="utf-8")
    entry.write_text("# 有正文但缺少技能元数据", encoding="utf-8")
    bad_skill = directory / "bad-skill.zip"
    pack(src, bad_skill)
    assert run_check(bad_skill, runtime, "rejected", 1)["error"] == "invalid_skill"
    print("通过：有效 ZIP 内含无效 Skill 时，导入器指出技能格式错误。")
    entry.write_text(skill_text, encoding="utf-8")

    refs_file = src / "dependencies.json"
    refs_text = refs_file.read_text(encoding="utf-8")
    wrong = json.loads(refs_text)
    wrong["skills"][0]["key"] = "undeclared"
    put_json(refs_file, wrong)
    bad_binding = directory / "undeclared.zip"
    pack(src, bad_binding)
    assert run_check(bad_binding, runtime, "rejected", 1)["error"] == "expert_package_invalid"
    print("通过：依赖未在专家清单声明时拒绝导入。")
    refs_file.write_text(refs_text, encoding="utf-8")

    template = src / "connectors/github-repos.json"
    settings = json.loads(template.read_text())
    put_json(template, {**settings, "token": "fixture-only"})
    secret = directory / "nonportable.zip"
    pack(src, secret)
    assert run_check(secret, runtime, "rejected", 1)["stage"] == "preview"
    print("通过：导入器拒绝含非空凭据字段的 MCP 模板。")

    put_json(template, settings)
    refs = json.loads(refs_text)
    refs["skills"] = [{"key": "release-brief", "source": "platform", "platform": "https://example.invalid",
                       "id": "example-skill", "versionId": "example-version", "sha256": "0" * 64}]
    put_json(refs_file, refs)
    shutil.rmtree(src / "skills")
    locked = directory / "needs-authorization.zip"
    pack(src, locked)
    blocked = run_check(locked, runtime, "blocked", 2)
    assert any(row["key"] == "release-brief" and row["status"] == "authorization" for row in blocked["preview"]["rows"])
    print("通过：必需平台 Skill 缺授权时阻塞导入，指出依赖。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--desktop")
    mode.add_argument("--workspace")
    args = parser.parse_args()
    runtime_args = []
    if args.desktop:
        runtime_args = ["--desktop", args.desktop]
    if args.workspace:
        runtime_args = ["--workspace", args.workspace]
    with tempfile.TemporaryDirectory(prefix="expert-import-eval-") as folder:
        exercise(Path(folder), runtime_args)
