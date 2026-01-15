"""
Tools Example

Create an agent with custom tools using the @tool decorator.
"""

import asyncio
from autonomi import Agent, tool


@tool
def calculate(expression: str) -> float:
    """
    Evaluate a mathematical expression.

    Args:
        expression: A mathematical expression like "2 + 2" or "sqrt(16)"

    Returns:
        The calculated result
    """
    import math
    # Safe evaluation with math functions
    allowed = {
        "sqrt": math.sqrt,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "log": math.log,
        "exp": math.exp,
        "pi": math.pi,
        "e": math.e,
    }
    return float(eval(expression, {"__builtins__": {}}, allowed))


@tool
def get_weather(city: str) -> str:
    """
    Get the current weather for a city.

    Args:
        city: Name of the city

    Returns:
        Weather description
    """
    # Mock implementation
    return f"The weather in {city} is sunny and 72F"


async def main() -> None:
    # Create an agent with tools
    agent = Agent(
        name="assistant",
        instructions="""You are a helpful assistant with access to tools.
        Use the calculate tool for math and get_weather for weather queries.""",
        tools=[calculate, get_weather],
    )

    # The agent will use tools to answer
    result = await agent.execute(
        "What is the square root of 256? Also, what's the weather in Tokyo?"
    )

    print(f"Response: {result.content}")
    print(f"\nTool calls made: {len(result.tool_calls)}")
    for call in result.tool_calls:
        print(f"  - {call.name}({call.arguments})")


if __name__ == "__main__":
    asyncio.run(main())
