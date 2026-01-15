"""
SKILL.md Import/Export Example

Load agents from SKILL.md files and export agents to SKILL.md format.
"""

import asyncio
import tempfile
from pathlib import Path
from autonomi import Agent, tool, load_skill, save_skill, skill_to_agent


# Sample SKILL.md content
SAMPLE_SKILL = """---
name: code-reviewer
version: 1.0.0
model: claude-sonnet-4-5
triggers:
  - "review this code"
  - "check my code"
---

# Code Reviewer

An expert code review agent that analyzes code for bugs, security issues,
and best practices.

## Instructions

You are an expert code reviewer. When reviewing code:

1. Check for common bugs and edge cases
2. Look for security vulnerabilities
3. Suggest performance improvements
4. Ensure code follows best practices
5. Provide constructive feedback

Be thorough but kind in your reviews.

## Tools

- `read_file`: Read source code files
- `analyze_ast`: Parse and analyze code structure
- `run_linter`: Run static analysis

## Constitution

1. Never approve code with known security vulnerabilities
2. Always explain the reasoning behind suggestions
3. Prioritize readability over cleverness
4. Respect the author's coding style when possible

## References

- OWASP Top 10 Security Risks
- Clean Code by Robert Martin
- PEP 8 Style Guide
"""


@tool
def read_file(path: str) -> str:
    """Read a file's contents."""
    return f"Contents of {path}"


@tool
def analyze_ast(code: str) -> dict:
    """Analyze code structure."""
    return {"type": "module", "statements": 10}


async def main() -> None:
    # Create a temporary SKILL.md file
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False
    ) as f:
        f.write(SAMPLE_SKILL)
        skill_path = f.name

    try:
        # Load the skill from file
        print("=== Loading SKILL.md ===")
        skill = load_skill(skill_path)
        print(f"Name: {skill.name}")
        print(f"Version: {skill.version}")
        print(f"Model: {skill.model}")
        print(f"Tools defined: {skill.tools}")
        print(f"Principles: {len(skill.constitution)}")
        print(f"Triggers: {skill.triggers}")

        # Convert to Agent with actual tools
        print("\n=== Converting to Agent ===")
        agent = skill_to_agent(skill, tools=[read_file, analyze_ast])
        print(f"Agent name: {agent.name}")
        print(f"Agent tools: {[t.name for t in agent.tools]}")
        print(f"Constitution: {agent.constitution}")

        # Or use the convenient class method
        print("\n=== Using Agent.from_skill ===")
        agent2 = Agent.from_skill(skill_path, tools=[read_file])
        print(f"Agent2 name: {agent2.name}")

        # Export an agent to SKILL.md
        print("\n=== Exporting Agent to SKILL.md ===")
        custom_agent = Agent(
            name="my-assistant",
            instructions="You are a helpful coding assistant.",
            model="claude-sonnet-4-5",
            tools=[read_file, analyze_ast],
            constitution=[
                "Always explain your reasoning",
                "Admit when you are unsure",
            ],
        )

        export_path = Path(tempfile.gettempdir()) / "exported_agent.md"
        save_skill(
            custom_agent,
            export_path,
            description="A custom coding assistant",
            version="2.0.0",
        )

        print(f"Exported to: {export_path}")
        print("\nExported content:")
        print("-" * 40)
        print(export_path.read_text())

    finally:
        # Cleanup
        Path(skill_path).unlink()


if __name__ == "__main__":
    asyncio.run(main())
