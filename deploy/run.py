"""Linux single-writer deployment entrypoint; retains the lock for process lifetime."""

import fcntl
import os
from pathlib import Path

from ishop.app import main

if __name__ == "__main__":
    database = Path(os.environ.get("RUNTIME_DATABASE_PATH", "/data/runtime.sqlite3"))
    database.parent.mkdir(parents=True, exist_ok=True)
    # Never delete this lock file: another process could still hold its inode.
    with database.with_suffix(database.suffix + ".writer.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another runtime already owns this database; refusing to start.")
        main()
