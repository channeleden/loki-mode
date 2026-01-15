"""
Workflow checkpointing for crash recovery.

Enables agents and orchestrators to survive crashes and resume from last checkpoint.
"""

import json
import sqlite3
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import threading


class CheckpointStatus(str, Enum):
    """Status of a checkpoint."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    RECOVERED = "recovered"


class RecoveryMode(str, Enum):
    """How to handle recovery on restart."""
    RESUME_FROM_LAST = "resume_from_last"
    RESTART_TASK = "restart_task"
    SKIP_FAILED = "skip_failed"
    MANUAL = "manual"


@dataclass
class Checkpoint:
    """A saved checkpoint of workflow state."""
    id: str
    workflow_id: str
    step_name: str
    step_index: int
    status: CheckpointStatus
    input_data: Dict[str, Any]
    output_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "workflow_id": self.workflow_id,
            "step_name": self.step_name,
            "step_index": self.step_index,
            "status": self.status.value if isinstance(self.status, CheckpointStatus) else self.status,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Checkpoint":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            workflow_id=data["workflow_id"],
            step_name=data["step_name"],
            step_index=data["step_index"],
            status=CheckpointStatus(data["status"]),
            input_data=data["input_data"],
            output_data=data.get("output_data"),
            error=data.get("error"),
            created_at=data.get("created_at", datetime.utcnow().isoformat()),
            updated_at=data.get("updated_at", datetime.utcnow().isoformat()),
            metadata=data.get("metadata", {}),
        )


class CheckpointBackend(ABC):
    """Abstract backend for checkpoint storage."""

    @abstractmethod
    def save(self, checkpoint: Checkpoint) -> None:
        """Save a checkpoint."""
        pass

    @abstractmethod
    def load(self, checkpoint_id: str) -> Optional[Checkpoint]:
        """Load a specific checkpoint."""
        pass

    @abstractmethod
    def list_workflow_checkpoints(self, workflow_id: str) -> List[Checkpoint]:
        """List all checkpoints for a workflow."""
        pass

    @abstractmethod
    def get_last_checkpoint(self, workflow_id: str) -> Optional[Checkpoint]:
        """Get the most recent checkpoint for a workflow."""
        pass

    @abstractmethod
    def delete_workflow_checkpoints(self, workflow_id: str) -> int:
        """Delete all checkpoints for a workflow. Returns count deleted."""
        pass

    @abstractmethod
    def get_incomplete_workflows(self) -> List[str]:
        """Get workflow IDs with incomplete checkpoints."""
        pass


class MemoryCheckpointBackend(CheckpointBackend):
    """In-memory checkpoint storage for testing."""

    def __init__(self) -> None:
        self._checkpoints: Dict[str, Checkpoint] = {}
        self._lock = threading.Lock()

    def save(self, checkpoint: Checkpoint) -> None:
        with self._lock:
            checkpoint.updated_at = datetime.utcnow().isoformat()
            self._checkpoints[checkpoint.id] = checkpoint

    def load(self, checkpoint_id: str) -> Optional[Checkpoint]:
        with self._lock:
            return self._checkpoints.get(checkpoint_id)

    def list_workflow_checkpoints(self, workflow_id: str) -> List[Checkpoint]:
        with self._lock:
            checkpoints = [
                cp for cp in self._checkpoints.values()
                if cp.workflow_id == workflow_id
            ]
            return sorted(checkpoints, key=lambda x: x.step_index)

    def get_last_checkpoint(self, workflow_id: str) -> Optional[Checkpoint]:
        checkpoints = self.list_workflow_checkpoints(workflow_id)
        return checkpoints[-1] if checkpoints else None

    def delete_workflow_checkpoints(self, workflow_id: str) -> int:
        with self._lock:
            to_delete = [
                cp_id for cp_id, cp in self._checkpoints.items()
                if cp.workflow_id == workflow_id
            ]
            for cp_id in to_delete:
                del self._checkpoints[cp_id]
            return len(to_delete)

    def get_incomplete_workflows(self) -> List[str]:
        with self._lock:
            incomplete = set()
            for cp in self._checkpoints.values():
                if cp.status in (CheckpointStatus.PENDING, CheckpointStatus.IN_PROGRESS):
                    incomplete.add(cp.workflow_id)
            return list(incomplete)


class SQLiteCheckpointBackend(CheckpointBackend):
    """SQLite-based checkpoint storage for persistence."""

    def __init__(self, path: Union[str, Path] = ".autonomi/checkpoints.db") -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Get thread-local connection."""
        if not hasattr(self._local, "conn"):
            self._local.conn = sqlite3.connect(str(self._path))
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _init_db(self) -> None:
        """Initialize the database schema."""
        conn = self._get_connection()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                input_data TEXT NOT NULL,
                output_data TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                metadata TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_workflow_id
            ON checkpoints(workflow_id)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_status
            ON checkpoints(status)
        """)
        conn.commit()

    def save(self, checkpoint: Checkpoint) -> None:
        conn = self._get_connection()
        checkpoint.updated_at = datetime.utcnow().isoformat()
        conn.execute("""
            INSERT OR REPLACE INTO checkpoints
            (id, workflow_id, step_name, step_index, status, input_data,
             output_data, error, created_at, updated_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            checkpoint.id,
            checkpoint.workflow_id,
            checkpoint.step_name,
            checkpoint.step_index,
            checkpoint.status.value if isinstance(checkpoint.status, CheckpointStatus) else checkpoint.status,
            json.dumps(checkpoint.input_data),
            json.dumps(checkpoint.output_data) if checkpoint.output_data else None,
            checkpoint.error,
            checkpoint.created_at,
            checkpoint.updated_at,
            json.dumps(checkpoint.metadata),
        ))
        conn.commit()

    def _row_to_checkpoint(self, row: sqlite3.Row) -> Checkpoint:
        """Convert database row to Checkpoint."""
        return Checkpoint(
            id=row["id"],
            workflow_id=row["workflow_id"],
            step_name=row["step_name"],
            step_index=row["step_index"],
            status=CheckpointStatus(row["status"]),
            input_data=json.loads(row["input_data"]),
            output_data=json.loads(row["output_data"]) if row["output_data"] else None,
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            metadata=json.loads(row["metadata"]) if row["metadata"] else {},
        )

    def load(self, checkpoint_id: str) -> Optional[Checkpoint]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM checkpoints WHERE id = ?",
            (checkpoint_id,)
        )
        row = cursor.fetchone()
        return self._row_to_checkpoint(row) if row else None

    def list_workflow_checkpoints(self, workflow_id: str) -> List[Checkpoint]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY step_index",
            (workflow_id,)
        )
        return [self._row_to_checkpoint(row) for row in cursor.fetchall()]

    def get_last_checkpoint(self, workflow_id: str) -> Optional[Checkpoint]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY step_index DESC LIMIT 1",
            (workflow_id,)
        )
        row = cursor.fetchone()
        return self._row_to_checkpoint(row) if row else None

    def delete_workflow_checkpoints(self, workflow_id: str) -> int:
        conn = self._get_connection()
        cursor = conn.execute(
            "DELETE FROM checkpoints WHERE workflow_id = ?",
            (workflow_id,)
        )
        conn.commit()
        return cursor.rowcount

    def get_incomplete_workflows(self) -> List[str]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT DISTINCT workflow_id FROM checkpoints WHERE status IN (?, ?)",
            (CheckpointStatus.PENDING.value, CheckpointStatus.IN_PROGRESS.value)
        )
        return [row["workflow_id"] for row in cursor.fetchall()]


class Checkpointer:
    """
    Manages checkpointing for workflow recovery.

    Example:
        from autonomi import Orchestrator, Checkpointer

        checkpointer = Checkpointer(backend="sqlite")
        orchestrator = Orchestrator(
            checkpointer=checkpointer,
            recovery_mode="resume_from_last"
        )
    """

    def __init__(
        self,
        backend: Union[str, CheckpointBackend] = "memory",
        path: Optional[str] = None,
        recovery_mode: Union[str, RecoveryMode] = RecoveryMode.RESUME_FROM_LAST,
        auto_cleanup: bool = True,
    ) -> None:
        """
        Initialize checkpointer.

        Args:
            backend: "memory", "sqlite", or a CheckpointBackend instance
            path: Path for SQLite backend
            recovery_mode: How to handle recovery
            auto_cleanup: Whether to clean up completed workflows
        """
        if isinstance(backend, str):
            if backend == "memory":
                self._backend = MemoryCheckpointBackend()
            elif backend == "sqlite":
                self._backend = SQLiteCheckpointBackend(
                    path=path or ".autonomi/checkpoints.db"
                )
            else:
                raise ValueError(f"Unknown backend: {backend}")
        else:
            self._backend = backend

        self.recovery_mode = (
            RecoveryMode(recovery_mode)
            if isinstance(recovery_mode, str)
            else recovery_mode
        )
        self.auto_cleanup = auto_cleanup
        self._workflow_counter = 0

    def generate_workflow_id(self, prefix: str = "workflow") -> str:
        """Generate a unique workflow ID."""
        self._workflow_counter += 1
        timestamp = int(time.time() * 1000)
        return f"{prefix}_{timestamp}_{self._workflow_counter}"

    def generate_checkpoint_id(self, workflow_id: str, step_index: int) -> str:
        """Generate a checkpoint ID."""
        return f"{workflow_id}_step_{step_index}"

    def checkpoint_start(
        self,
        workflow_id: str,
        step_name: str,
        step_index: int,
        input_data: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Checkpoint:
        """
        Create a checkpoint at the start of a step.

        Args:
            workflow_id: Workflow identifier
            step_name: Name of the step
            step_index: Index in the workflow
            input_data: Input to this step
            metadata: Additional metadata

        Returns:
            Created checkpoint
        """
        checkpoint = Checkpoint(
            id=self.generate_checkpoint_id(workflow_id, step_index),
            workflow_id=workflow_id,
            step_name=step_name,
            step_index=step_index,
            status=CheckpointStatus.IN_PROGRESS,
            input_data=input_data,
            metadata=metadata or {},
        )
        self._backend.save(checkpoint)
        return checkpoint

    def checkpoint_complete(
        self,
        checkpoint: Checkpoint,
        output_data: Dict[str, Any],
    ) -> Checkpoint:
        """
        Mark a checkpoint as completed.

        Args:
            checkpoint: The checkpoint to update
            output_data: Output from this step

        Returns:
            Updated checkpoint
        """
        checkpoint.status = CheckpointStatus.COMPLETED
        checkpoint.output_data = output_data
        self._backend.save(checkpoint)
        return checkpoint

    def checkpoint_failed(
        self,
        checkpoint: Checkpoint,
        error: str,
    ) -> Checkpoint:
        """
        Mark a checkpoint as failed.

        Args:
            checkpoint: The checkpoint to update
            error: Error message

        Returns:
            Updated checkpoint
        """
        checkpoint.status = CheckpointStatus.FAILED
        checkpoint.error = error
        self._backend.save(checkpoint)
        return checkpoint

    def get_recovery_point(self, workflow_id: str) -> Optional[Checkpoint]:
        """
        Get the checkpoint to resume from.

        Based on recovery_mode:
        - RESUME_FROM_LAST: Last checkpoint regardless of status
        - RESTART_TASK: Last failed checkpoint (to retry)
        - SKIP_FAILED: Last completed checkpoint
        - MANUAL: Returns None (user decides)

        Args:
            workflow_id: Workflow identifier

        Returns:
            Checkpoint to resume from, or None
        """
        if self.recovery_mode == RecoveryMode.MANUAL:
            return None

        checkpoints = self._backend.list_workflow_checkpoints(workflow_id)
        if not checkpoints:
            return None

        if self.recovery_mode == RecoveryMode.RESUME_FROM_LAST:
            return checkpoints[-1]

        if self.recovery_mode == RecoveryMode.RESTART_TASK:
            # Find last failed or in-progress
            for cp in reversed(checkpoints):
                if cp.status in (CheckpointStatus.FAILED, CheckpointStatus.IN_PROGRESS):
                    return cp
            return checkpoints[-1]

        if self.recovery_mode == RecoveryMode.SKIP_FAILED:
            # Find last completed
            for cp in reversed(checkpoints):
                if cp.status == CheckpointStatus.COMPLETED:
                    return cp
            return None

        return checkpoints[-1]

    def get_incomplete_workflows(self) -> List[str]:
        """Get all workflow IDs with incomplete checkpoints."""
        return self._backend.get_incomplete_workflows()

    def list_checkpoints(self, workflow_id: str) -> List[Checkpoint]:
        """List all checkpoints for a workflow."""
        return self._backend.list_workflow_checkpoints(workflow_id)

    def cleanup_workflow(self, workflow_id: str) -> int:
        """
        Delete all checkpoints for a completed workflow.

        Args:
            workflow_id: Workflow identifier

        Returns:
            Number of checkpoints deleted
        """
        return self._backend.delete_workflow_checkpoints(workflow_id)

    def mark_recovered(self, checkpoint: Checkpoint) -> Checkpoint:
        """Mark a checkpoint as recovered (being retried)."""
        checkpoint.status = CheckpointStatus.RECOVERED
        self._backend.save(checkpoint)
        return checkpoint


class CheckpointContext:
    """
    Context manager for automatic checkpointing.

    Example:
        async with checkpointer.context(workflow_id, "step1", 0, input_data) as ctx:
            result = await do_work()
            ctx.set_output(result)
    """

    def __init__(
        self,
        checkpointer: Checkpointer,
        workflow_id: str,
        step_name: str,
        step_index: int,
        input_data: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self._checkpointer = checkpointer
        self._workflow_id = workflow_id
        self._step_name = step_name
        self._step_index = step_index
        self._input_data = input_data
        self._metadata = metadata
        self._checkpoint: Optional[Checkpoint] = None
        self._output: Optional[Dict[str, Any]] = None

    def set_output(self, output: Dict[str, Any]) -> None:
        """Set the output data for this step."""
        self._output = output

    def __enter__(self) -> "CheckpointContext":
        self._checkpoint = self._checkpointer.checkpoint_start(
            workflow_id=self._workflow_id,
            step_name=self._step_name,
            step_index=self._step_index,
            input_data=self._input_data,
            metadata=self._metadata,
        )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if self._checkpoint is None:
            return False

        if exc_type is not None:
            # Exception occurred
            self._checkpointer.checkpoint_failed(
                self._checkpoint,
                error=str(exc_val),
            )
            return False

        if self._output is not None:
            self._checkpointer.checkpoint_complete(
                self._checkpoint,
                output_data=self._output,
            )
        else:
            # No output set, mark as completed with empty output
            self._checkpointer.checkpoint_complete(
                self._checkpoint,
                output_data={},
            )

        return False

    async def __aenter__(self) -> "CheckpointContext":
        return self.__enter__()

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        return self.__exit__(exc_type, exc_val, exc_tb)

    @property
    def checkpoint(self) -> Optional[Checkpoint]:
        """Get the current checkpoint."""
        return self._checkpoint


# Add context method to Checkpointer
def _checkpointer_context(
    self: Checkpointer,
    workflow_id: str,
    step_name: str,
    step_index: int,
    input_data: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> CheckpointContext:
    """Create a checkpoint context manager."""
    return CheckpointContext(
        checkpointer=self,
        workflow_id=workflow_id,
        step_name=step_name,
        step_index=step_index,
        input_data=input_data,
        metadata=metadata,
    )


Checkpointer.context = _checkpointer_context  # type: ignore
