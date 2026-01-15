"""
Orchestration Example

Coordinate multiple agents with different patterns.
"""

import asyncio
from autonomi import Agent, Orchestrator, OrchestratorMode


async def main() -> None:
    # Create specialized agents
    frontend_agent = Agent(
        name="frontend",
        instructions="""You are a frontend developer expert.
        You specialize in React, TypeScript, and CSS.""",
    )

    backend_agent = Agent(
        name="backend",
        instructions="""You are a backend developer expert.
        You specialize in Python, APIs, and databases.""",
    )

    reviewer_agent = Agent(
        name="reviewer",
        instructions="""You are a code reviewer.
        Review code for bugs, security issues, and best practices.""",
    )

    # Router Pattern - Select one agent based on task
    print("=== Router Pattern ===")
    router = Orchestrator(mode=OrchestratorMode.ROUTER)
    router.add_agent(frontend_agent, role="frontend")
    router.add_agent(backend_agent, role="backend")

    result = await router.run(
        task="How do I create a React component with TypeScript?",
        context={},
    )
    print(f"Selected: {result.selected_agent}")
    print(f"Response: {result.content[:200]}...\n")

    # Parallel Pattern - Run multiple agents simultaneously
    print("=== Parallel Pattern ===")
    parallel = Orchestrator(mode=OrchestratorMode.PARALLEL)
    parallel.add_agent(frontend_agent, role="frontend")
    parallel.add_agent(backend_agent, role="backend")

    result = await parallel.run(
        task="What are best practices for building web applications?",
        context={},
    )
    print(f"Agents responded: {len(result.agent_results)}")
    for agent_name, agent_result in result.agent_results.items():
        print(f"\n{agent_name}:")
        print(f"  {agent_result.content[:150]}...")

    # Pipeline Pattern - Sequential execution
    print("\n=== Pipeline Pattern ===")
    pipeline = Orchestrator(mode=OrchestratorMode.PIPELINE)
    pipeline.add_agent(backend_agent, stage=1)
    pipeline.add_agent(reviewer_agent, stage=2)

    result = await pipeline.run(
        task="Write a Python function to validate email addresses",
        context={},
    )
    print(f"Stages completed: {len(result.stage_results)}")
    print(f"Final output: {result.content[:300]}...")


if __name__ == "__main__":
    asyncio.run(main())
