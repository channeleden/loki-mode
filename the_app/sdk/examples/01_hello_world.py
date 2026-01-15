"""
Hello World Example

The simplest possible agent - just 5 lines of code.
"""

import asyncio
from autonomi import Agent


async def main() -> None:
    # Create a simple agent
    agent = Agent(
        name="greeter",
        instructions="You are a friendly assistant. Greet users warmly.",
    )

    # Execute a prompt
    result = await agent.execute("Hello! Who are you?")

    print(f"Agent response: {result.content}")
    print(f"Tokens used: {result.usage.total_tokens}")


if __name__ == "__main__":
    asyncio.run(main())
