from __future__ import annotations

import json


def split_front_matter(text: str) -> tuple[list[str], str]:
    normalized = text.replace("\r\n", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing opening front matter delimiter")
    try:
        closing = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration as error:
        raise ValueError("missing closing front matter delimiter") from error
    return lines[1:closing], "\n".join(lines[closing + 1 :])


def parse_scalar(front: list[str], key: str) -> str:
    prefix = f"{key}:"
    for line in front:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        if not raw:
            return ""
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip('"').strip()
        return str(value).strip()
    return ""


def project_formats(text: str) -> tuple[str, str]:
    front, body = split_front_matter(text)
    entry_type = parse_scalar(front, "entryType")
    if not entry_type:
        raise ValueError("entryType is required for reader discovery taxonomy projection")

    cleaned = [line for line in front if not line.startswith("formats:")]
    insertion = next(
        (index + 1 for index, line in enumerate(cleaned) if line.startswith("entryType:")),
        len(cleaned),
    )
    cleaned[insertion:insertion] = [
        f"formats: [{json.dumps(entry_type, ensure_ascii=False)}]"
    ]

    rewritten = "---\n" + "\n".join(cleaned) + "\n---\n" + body
    if not rewritten.endswith("\n"):
        rewritten += "\n"
    return rewritten, entry_type
