"""
Checkpointing Example

Survive crashes and resume workflows from checkpoints.
"""

import asyncio
from autonomi import (
    Checkpointer,
    CheckpointStatus,
    RecoveryMode,
)


async def simulate_workflow(checkpointer: Checkpointer) -> None:
    """Simulate a multi-step workflow with checkpointing."""

    workflow_id = checkpointer.generate_workflow_id("data_pipeline")
    print(f"Starting workflow: {workflow_id}")

    steps = [
        ("fetch_data", {"source": "api.example.com"}),
        ("transform_data", {"format": "json"}),
        ("validate_data", {"schema": "v1"}),
        ("store_data", {"destination": "database"}),
    ]

    for i, (step_name, input_data) in enumerate(steps):
        # Create checkpoint at step start
        async with checkpointer.context(
            workflow_id=workflow_id,
            step_name=step_name,
            step_index=i,
            input_data=input_data,
        ) as ctx:
            print(f"  Executing step {i + 1}: {step_name}")

            # Simulate step execution
            await asyncio.sleep(0.1)

            # Simulate a failure on step 3 (first run)
            if step_name == "validate_data" and i == 2:
                # Comment out to simulate successful run
                # raise ValueError("Simulated validation failure!")
                pass

            # Set output for checkpoint
            ctx.set_output({"status": "success", "step": step_name})

    print(f"Workflow {workflow_id} completed successfully!")
    return workflow_id


async def check_for_incomplete_workflows(checkpointer: Checkpointer) -> None:
    """Check for and resume incomplete workflows."""

    incomplete = checkpointer.get_incomplete_workflows()
    if incomplete:
        print(f"\nFound {len(incomplete)} incomplete workflow(s):")
        for wf_id in incomplete:
            print(f"  - {wf_id}")

            # Get recovery point
            recovery = checkpointer.get_recovery_point(wf_id)
            if recovery:
                print(f"    Recovery point: step {recovery.step_index} ({recovery.step_name})")
                print(f"    Status: {recovery.status.value}")

                # In a real app, you would resume from here
                if recovery.status == CheckpointStatus.FAILED:
                    print(f"    Error: {recovery.error}")
    else:
        print("\nNo incomplete workflows found.")


async def main() -> None:
    # Create checkpointer with SQLite backend for persistence
    checkpointer = Checkpointer(
        backend="sqlite",
        path=".autonomi/checkpoints.db",
        recovery_mode=RecoveryMode.RESUME_FROM_LAST,
    )

    # Check for any previously incomplete workflows
    await check_for_incomplete_workflows(checkpointer)

    # Run a new workflow
    print("\n" + "=" * 50)
    print("Running new workflow...")
    print("=" * 50 + "\n")

    try:
        workflow_id = await simulate_workflow(checkpointer)

        # Show all checkpoints for the workflow
        print("\nCheckpoint history:")
        for cp in checkpointer.list_checkpoints(workflow_id):
            print(f"  {cp.step_index}: {cp.step_name} - {cp.status.value}")

        # Clean up completed workflow (optional)
        if checkpointer.auto_cleanup:
            deleted = checkpointer.cleanup_workflow(workflow_id)
            print(f"\nCleaned up {deleted} checkpoints")

    except Exception as e:
        print(f"\nWorkflow failed: {e}")
        print("Checkpoints preserved for recovery.")

        # Check incomplete workflows again
        await check_for_incomplete_workflows(checkpointer)


if __name__ == "__main__":
    asyncio.run(main())
