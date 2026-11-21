#!/usr/bin/env python3
"""将准备好的单专家目录打成 Actvero v1 ZIP，保留原始文件字节。"""

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

MIB = 1024 * 1024


def build(source, target):
    if not source.is_dir() or source.is_symlink():
        raise ValueError("请指定实际的专家文件目录。")
    if target.suffix.lower() != ".zip" or source.resolve() in target.resolve().parents:
        raise ValueError("请在输入目录以外指定 .zip 输出文件。")
    if not all((source / name).is_file() for name in ("expert.json", "dependencies.json")):
        raise ValueError("输入目录根层需要 expert.json 和 dependencies.json。")

    buffer = io.BytesIO()
    inventory = []
    total = 0
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            member = path.relative_to(source).as_posix()
            if path.is_symlink():
                raise ValueError(f"包内路径不能是符号链接：{member}")
            if path.is_dir() or path.name == ".DS_Store" or member == "package.json":
                continue
            if member not in ("expert.json", "dependencies.json") and not member.startswith(("skills/", "connectors/")):
                raise ValueError(f"请把非交付文件移出专家目录：{member}")
            if not path.is_file() or path.stat().st_size > 5 * MIB:
                raise ValueError(f"文件类型或大小不符合桌面导入限制：{member}")
            with path.open("rb") as handle:
                data = handle.read(5 * MIB + 1)
            total += len(data)
            if len(data) > 5 * MIB or total > 40 * MIB or len(inventory) >= 499:
                raise ValueError(f"超出桌面包大小或文件数限制：{member}")
            inventory.append({"path": member, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            archive.writestr(member, data)
        header = json.dumps({"format": "actvero-expert", "schemaVersion": 1, "files": inventory},
                            ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(header) > 700_000 or total + len(header) > 40 * MIB:
            raise ValueError("专家文件清单超过导入限制。")
        archive.writestr("package.json", header)
    if len(buffer.getbuffer()) > 20 * MIB:
        raise ValueError("压缩文件超过 20 MiB。")
    # 只创建新文件。写盘中断时丢弃本次未写完的输出。
    with target.open("xb") as handle:
        try:
            handle.write(buffer.getbuffer())
            handle.flush()
        except OSError:
            handle.close()
            target.unlink()
            raise
    return {"status": "packed", "path": str(target.resolve()), "files": len(inventory) + 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="包含 expert.json 和 dependencies.json 的目录")
    parser.add_argument("target", type=Path, help="将要新建的 .zip 路径")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.source, args.target), ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
