"""Consistent online SQLite snapshot; never copy a live database file directly."""

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def backup_database(source: Path, destination: Path) -> Path:
    source = source.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = destination / f"runtime-{timestamp}.sqlite3"
    temporary = target.with_suffix(".partial")
    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)) as reader:
            with closing(sqlite3.connect(temporary)) as writer:
                reader.backup(writer, pages=256, sleep=0.1)
                if writer.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup integrity check failed")
        temporary.chmod(0o600)
        with temporary.open("r+b") as snapshot:
            os.fsync(snapshot.fileno())
        temporary.replace(target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return target


if __name__ == "__main__":
    result = backup_database(
        Path(os.environ.get("RUNTIME_DATABASE_PATH", "/data/runtime.sqlite3")),
        Path("/backups"),
    )
    print(f"Verified SQLite backup: {result.name}")
