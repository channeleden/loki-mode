"""Tests for checkpointing."""

import pytest
import tempfile
import os
from pathlib import Path
from autonomi import (
    Checkpointer,
    Checkpoint,
    CheckpointStatus,
    RecoveryMode,
)


class TestCheckpoint:
    """Test Checkpoint dataclass."""

    def test_checkpoint_creation(self) -> None:
        """Test creating a checkpoint."""
        cp = Checkpoint(
            id="test_1",
            workflow_id="workflow_1",
            step_name="step_1",
            step_index=0,
            status=CheckpointStatus.PENDING,
            input_data={"task": "test"},
        )
        assert cp.id == "test_1"
        assert cp.workflow_id == "workflow_1"
        assert cp.status == CheckpointStatus.PENDING

    def test_checkpoint_to_dict(self) -> None:
        """Test converting checkpoint to dict."""
        cp = Checkpoint(
            id="test_1",
            workflow_id="workflow_1",
            step_name="step_1",
            step_index=0,
            status=CheckpointStatus.COMPLETED,
            input_data={"x": 1},
            output_data={"y": 2},
        )
        d = cp.to_dict()
        assert d["id"] == "test_1"
        assert d["status"] == "completed"
        assert d["input_data"] == {"x": 1}
        assert d["output_data"] == {"y": 2}

    def test_checkpoint_from_dict(self) -> None:
        """Test creating checkpoint from dict."""
        d = {
            "id": "test_1",
            "workflow_id": "workflow_1",
            "step_name": "step_1",
            "step_index": 0,
            "status": "in_progress",
            "input_data": {"task": "test"},
        }
        cp = Checkpoint.from_dict(d)
        assert cp.id == "test_1"
        assert cp.status == CheckpointStatus.IN_PROGRESS


class TestMemoryCheckpointer:
    """Test in-memory checkpointer."""

    def test_basic_checkpoint_flow(self) -> None:
        """Test basic checkpoint start/complete flow."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        # Start checkpoint
        cp = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={"task": "test"},
        )
        assert cp.status == CheckpointStatus.IN_PROGRESS

        # Complete checkpoint
        cp = checkpointer.checkpoint_complete(
            checkpoint=cp,
            output_data={"result": "success"},
        )
        assert cp.status == CheckpointStatus.COMPLETED
        assert cp.output_data == {"result": "success"}

    def test_checkpoint_failure(self) -> None:
        """Test checkpoint failure."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        cp = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={"task": "test"},
        )

        cp = checkpointer.checkpoint_failed(
            checkpoint=cp,
            error="Something went wrong",
        )
        assert cp.status == CheckpointStatus.FAILED
        assert cp.error == "Something went wrong"

    def test_list_workflow_checkpoints(self) -> None:
        """Test listing checkpoints for a workflow."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        # Create multiple checkpoints
        for i in range(3):
            cp = checkpointer.checkpoint_start(
                workflow_id=workflow_id,
                step_name=f"step_{i}",
                step_index=i,
                input_data={"i": i},
            )
            checkpointer.checkpoint_complete(cp, output_data={"done": True})

        checkpoints = checkpointer.list_checkpoints(workflow_id)
        assert len(checkpoints) == 3
        assert checkpoints[0].step_index == 0
        assert checkpoints[2].step_index == 2

    def test_get_incomplete_workflows(self) -> None:
        """Test getting incomplete workflows."""
        checkpointer = Checkpointer(backend="memory")

        # Create incomplete workflow
        wf1 = checkpointer.generate_workflow_id("wf1")
        checkpointer.checkpoint_start(
            workflow_id=wf1,
            step_name="step_1",
            step_index=0,
            input_data={},
        )

        # Create completed workflow
        wf2 = checkpointer.generate_workflow_id("wf2")
        cp = checkpointer.checkpoint_start(
            workflow_id=wf2,
            step_name="step_1",
            step_index=0,
            input_data={},
        )
        checkpointer.checkpoint_complete(cp, output_data={})

        incomplete = checkpointer.get_incomplete_workflows()
        assert wf1 in incomplete
        assert wf2 not in incomplete


class TestRecoveryModes:
    """Test different recovery modes."""

    def test_resume_from_last(self) -> None:
        """Test RESUME_FROM_LAST recovery mode."""
        checkpointer = Checkpointer(
            backend="memory",
            recovery_mode=RecoveryMode.RESUME_FROM_LAST,
        )
        workflow_id = checkpointer.generate_workflow_id()

        # Create checkpoints: completed, in_progress
        cp1 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={},
        )
        checkpointer.checkpoint_complete(cp1, output_data={})

        cp2 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_2",
            step_index=1,
            input_data={},
        )

        recovery = checkpointer.get_recovery_point(workflow_id)
        assert recovery is not None
        assert recovery.step_index == 1  # Last checkpoint

    def test_skip_failed(self) -> None:
        """Test SKIP_FAILED recovery mode."""
        checkpointer = Checkpointer(
            backend="memory",
            recovery_mode=RecoveryMode.SKIP_FAILED,
        )
        workflow_id = checkpointer.generate_workflow_id()

        # Create checkpoints: completed, failed
        cp1 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={},
        )
        checkpointer.checkpoint_complete(cp1, output_data={})

        cp2 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_2",
            step_index=1,
            input_data={},
        )
        checkpointer.checkpoint_failed(cp2, error="Error")

        recovery = checkpointer.get_recovery_point(workflow_id)
        assert recovery is not None
        assert recovery.step_index == 0  # Last completed

    def test_restart_task(self) -> None:
        """Test RESTART_TASK recovery mode."""
        checkpointer = Checkpointer(
            backend="memory",
            recovery_mode=RecoveryMode.RESTART_TASK,
        )
        workflow_id = checkpointer.generate_workflow_id()

        # Create checkpoints: completed, failed
        cp1 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={},
        )
        checkpointer.checkpoint_complete(cp1, output_data={})

        cp2 = checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_2",
            step_index=1,
            input_data={},
        )
        checkpointer.checkpoint_failed(cp2, error="Error")

        recovery = checkpointer.get_recovery_point(workflow_id)
        assert recovery is not None
        assert recovery.step_index == 1  # Failed checkpoint to retry
        assert recovery.status == CheckpointStatus.FAILED

    def test_manual_mode(self) -> None:
        """Test MANUAL recovery mode returns None."""
        checkpointer = Checkpointer(
            backend="memory",
            recovery_mode=RecoveryMode.MANUAL,
        )
        workflow_id = checkpointer.generate_workflow_id()

        checkpointer.checkpoint_start(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={},
        )

        recovery = checkpointer.get_recovery_point(workflow_id)
        assert recovery is None


class TestSQLiteCheckpointer:
    """Test SQLite checkpointer."""

    def test_persistence(self) -> None:
        """Test that checkpoints persist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "checkpoints.db")

            # Create checkpointer and add checkpoint
            checkpointer1 = Checkpointer(backend="sqlite", path=db_path)
            workflow_id = checkpointer1.generate_workflow_id()

            cp = checkpointer1.checkpoint_start(
                workflow_id=workflow_id,
                step_name="step_1",
                step_index=0,
                input_data={"test": "data"},
            )
            checkpointer1.checkpoint_complete(cp, output_data={"result": "ok"})

            # Create new checkpointer and verify data persists
            checkpointer2 = Checkpointer(backend="sqlite", path=db_path)
            checkpoints = checkpointer2.list_checkpoints(workflow_id)

            assert len(checkpoints) == 1
            assert checkpoints[0].input_data == {"test": "data"}
            assert checkpoints[0].output_data == {"result": "ok"}

    def test_cleanup_workflow(self) -> None:
        """Test cleaning up workflow checkpoints."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "checkpoints.db")
            checkpointer = Checkpointer(backend="sqlite", path=db_path)
            workflow_id = checkpointer.generate_workflow_id()

            # Create checkpoints
            for i in range(3):
                cp = checkpointer.checkpoint_start(
                    workflow_id=workflow_id,
                    step_name=f"step_{i}",
                    step_index=i,
                    input_data={},
                )
                checkpointer.checkpoint_complete(cp, output_data={})

            # Cleanup
            deleted = checkpointer.cleanup_workflow(workflow_id)
            assert deleted == 3

            # Verify gone
            checkpoints = checkpointer.list_checkpoints(workflow_id)
            assert len(checkpoints) == 0


class TestCheckpointContext:
    """Test checkpoint context manager."""

    def test_context_success(self) -> None:
        """Test context manager on success."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        with checkpointer.context(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={"x": 1},
        ) as ctx:
            ctx.set_output({"y": 2})

        checkpoints = checkpointer.list_checkpoints(workflow_id)
        assert len(checkpoints) == 1
        assert checkpoints[0].status == CheckpointStatus.COMPLETED
        assert checkpoints[0].output_data == {"y": 2}

    def test_context_failure(self) -> None:
        """Test context manager on failure."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        with pytest.raises(ValueError):
            with checkpointer.context(
                workflow_id=workflow_id,
                step_name="step_1",
                step_index=0,
                input_data={"x": 1},
            ) as ctx:
                raise ValueError("Test error")

        checkpoints = checkpointer.list_checkpoints(workflow_id)
        assert len(checkpoints) == 1
        assert checkpoints[0].status == CheckpointStatus.FAILED
        assert "Test error" in checkpoints[0].error

    @pytest.mark.asyncio
    async def test_async_context(self) -> None:
        """Test async context manager."""
        checkpointer = Checkpointer(backend="memory")
        workflow_id = checkpointer.generate_workflow_id()

        async with checkpointer.context(
            workflow_id=workflow_id,
            step_name="step_1",
            step_index=0,
            input_data={"x": 1},
        ) as ctx:
            ctx.set_output({"y": 2})

        checkpoints = checkpointer.list_checkpoints(workflow_id)
        assert len(checkpoints) == 1
        assert checkpoints[0].status == CheckpointStatus.COMPLETED
