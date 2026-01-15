"""
Multi-Provider and Cost Tracking Example

Switch between providers and track costs.
"""

import asyncio
import os
from autonomi import (
    Agent,
    AnthropicProvider,
    OpenAIProvider,
    OllamaProvider,
    CostTracker,
    Budget,
)


async def main() -> None:
    # Configure providers
    # Note: Set API keys via environment variables:
    # - ANTHROPIC_API_KEY
    # - OPENAI_API_KEY

    print("=== Provider Configuration ===\n")

    # Anthropic provider (default)
    anthropic = AnthropicProvider(
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        default_model="claude-sonnet-4-5",
    )

    # OpenAI provider
    openai = OpenAIProvider(
        api_key=os.getenv("OPENAI_API_KEY"),
        default_model="gpt-4o",
    )

    # Local Ollama provider (no API key needed)
    ollama = OllamaProvider(
        base_url="http://localhost:11434",
        default_model="llama3.1",
    )

    # Create cost tracker with budget
    budget = Budget(
        per_task=1.00,      # $1 max per task
        per_session=10.00,  # $10 max per session
        per_day=50.00,      # $50 max per day
        on_exceed="PAUSE",  # Pause when exceeded
    )
    cost_tracker = CostTracker(budget=budget)

    print("Budget configured:")
    print(f"  Per task: ${budget.per_task}")
    print(f"  Per session: ${budget.per_session}")
    print(f"  Per day: ${budget.per_day}")

    # Create agents with different providers
    print("\n=== Creating Agents ===\n")

    claude_agent = Agent(
        name="claude-agent",
        instructions="You are a helpful assistant powered by Claude.",
        provider=anthropic,
        cost_tracker=cost_tracker,
    )

    gpt_agent = Agent(
        name="gpt-agent",
        instructions="You are a helpful assistant powered by GPT-4.",
        provider=openai,
        cost_tracker=cost_tracker,
    )

    local_agent = Agent(
        name="local-agent",
        instructions="You are a helpful assistant running locally.",
        provider=ollama,
        cost_tracker=cost_tracker,
    )

    # Example: Use Claude agent
    print("=== Using Claude Agent ===")
    if os.getenv("ANTHROPIC_API_KEY"):
        result = await claude_agent.execute("What is 2 + 2?")
        print(f"Response: {result.content}")
        print(f"Cost: ${cost_tracker.last_task_cost:.4f}")
    else:
        print("Skipped (ANTHROPIC_API_KEY not set)")

    # Example: Use GPT agent
    print("\n=== Using GPT Agent ===")
    if os.getenv("OPENAI_API_KEY"):
        result = await gpt_agent.execute("What is 3 + 3?")
        print(f"Response: {result.content}")
        print(f"Cost: ${cost_tracker.last_task_cost:.4f}")
    else:
        print("Skipped (OPENAI_API_KEY not set)")

    # Show session totals
    print("\n=== Cost Summary ===")
    print(f"Session total: ${cost_tracker.session_total:.4f}")
    print(f"Budget remaining: ${budget.per_session - cost_tracker.session_total:.2f}")

    # Agent with fallback providers
    print("\n=== Agent with Fallback ===")
    resilient_agent = Agent(
        name="resilient",
        instructions="You are a resilient assistant.",
        provider=anthropic,
        fallback_providers=[openai, ollama],  # Try these if primary fails
        cost_tracker=cost_tracker,
    )
    print("Configured with fallback chain: Anthropic -> OpenAI -> Ollama")


if __name__ == "__main__":
    asyncio.run(main())
