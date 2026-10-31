import importlib.util
import sqlite3
from pathlib import Path

import pytest


def load_backup():
    path = Path(__file__).parents[1] / "deploy/backup.py"
    spec = importlib.util.spec_from_file_location("ishop_backup", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.backup_database


def test_online_backup_contains_committed_wal_data(tmp_path):
    database = tmp_path / "source.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE evidence (value TEXT)")
        connection.execute("INSERT INTO evidence VALUES ('committed')")
        connection.commit()
        result = load_backup()(database, tmp_path / "backups")
        with sqlite3.connect(result) as restored:
            assert restored.execute("SELECT value FROM evidence").fetchone() == ("committed",)
            assert restored.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_backup_missing_database_does_not_create_empty_snapshot(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_backup()(tmp_path / "missing.sqlite3", tmp_path / "backups")
    assert not (tmp_path / "backups").exists()
