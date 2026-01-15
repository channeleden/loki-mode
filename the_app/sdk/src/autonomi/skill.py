"""
SKILL.md import/export for the Autonomi SDK.

Enables loading agents from SKILL.md files and exporting agents to SKILL.md format.
"""

import re
import yaml
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from autonomi.agent import Agent
from autonomi.tool import Tool


@dataclass
class SkillDefinition:
    """Parsed SKILL.md definition."""
    name: str
    version: str = "1.0.0"
    description: str = ""
    instructions: str = ""
    model: str = "claude-sonnet-4-20250514"
    tools: List[str] = field(default_factory=list)
    constitution: List[str] = field(default_factory=list)
    triggers: List[str] = field(default_factory=list)
    references: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


def parse_skill_md(content: str) -> SkillDefinition:
    """
    Parse a SKILL.md file content.

    Args:
        content: SKILL.md file content

    Returns:
        Parsed SkillDefinition
    """
    skill = SkillDefinition(name="skill")

    # Extract YAML frontmatter if present
    frontmatter_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if frontmatter_match:
        try:
            frontmatter = yaml.safe_load(frontmatter_match.group(1))
            skill.name = frontmatter.get("name", skill.name)
            skill.version = frontmatter.get("version", skill.version)
            skill.description = frontmatter.get("description", skill.description)
            skill.model = frontmatter.get("model", skill.model)
            skill.triggers = frontmatter.get("triggers", [])
            skill.metadata = frontmatter
        except yaml.YAMLError:
            pass
        content = content[frontmatter_match.end():]

    # Extract title
    title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if title_match and not skill.name:
        skill.name = title_match.group(1).strip()

    # Extract description (first paragraph after title)
    desc_match = re.search(r"^#\s+.+\n\n(.+?)(?=\n\n|\n#)", content, re.DOTALL)
    if desc_match and not skill.description:
        skill.description = desc_match.group(1).strip()

    # Extract instructions section
    instructions_match = re.search(
        r"##\s+(?:Instructions?|System Prompt|Prompt)\s*\n(.*?)(?=\n##|\Z)",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if instructions_match:
        skill.instructions = instructions_match.group(1).strip()

    # Extract tools section
    tools_match = re.search(
        r"##\s+Tools?\s*\n(.*?)(?=\n##|\Z)",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if tools_match:
        tools_content = tools_match.group(1)
        # Extract tool names from list items
        skill.tools = re.findall(r"[-*]\s+`?(\w+)`?", tools_content)

    # Extract constitution/principles section
    principles_match = re.search(
        r"##\s+(?:Constitution|Principles?|Rules?)\s*\n(.*?)(?=\n##|\Z)",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if principles_match:
        principles_content = principles_match.group(1)
        # Extract principles from numbered or bulleted list
        skill.constitution = re.findall(
            r"(?:^|\n)\s*(?:\d+[.)]|[-*])\s+(.+?)(?=\n|$)",
            principles_content,
        )

    # Extract references section
    refs_match = re.search(
        r"##\s+References?\s*\n(.*?)(?=\n##|\Z)",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if refs_match:
        refs_content = refs_match.group(1)
        skill.references = re.findall(r"[-*]\s+(.+?)(?=\n|$)", refs_content)

    return skill


def load_skill(path: Union[str, Path]) -> SkillDefinition:
    """
    Load a SKILL.md file.

    Args:
        path: Path to SKILL.md file

    Returns:
        Parsed SkillDefinition
    """
    path = Path(path)
    content = path.read_text()
    return parse_skill_md(content)


def skill_to_agent(
    skill: SkillDefinition,
    tools: Optional[List[Tool]] = None,
    **kwargs: Any,
) -> Agent:
    """
    Convert a SkillDefinition to an Agent.

    Args:
        skill: Parsed skill definition
        tools: Tools to attach (overrides skill.tools)
        **kwargs: Additional Agent arguments

    Returns:
        Configured Agent
    """
    return Agent(
        name=skill.name,
        instructions=skill.instructions or skill.description,
        model=skill.model,
        tools=tools or [],
        constitution=skill.constitution,
        **kwargs,
    )


def agent_to_skill_md(
    agent: Agent,
    description: str = "",
    version: str = "1.0.0",
    references: Optional[List[str]] = None,
) -> str:
    """
    Export an Agent to SKILL.md format.

    Args:
        agent: Agent to export
        description: Short description
        version: Skill version
        references: Reference documentation

    Returns:
        SKILL.md content
    """
    lines = [
        "---",
        f"name: {agent.name}",
        f"version: {version}",
        f"model: {agent.model}",
        "---",
        "",
        f"# {agent.name}",
        "",
    ]

    if description:
        lines.extend([description, ""])

    if agent.instructions:
        lines.extend([
            "## Instructions",
            "",
            agent.instructions,
            "",
        ])

    if agent.tools:
        lines.extend(["## Tools", ""])
        for tool in agent.tools:
            lines.append(f"- `{tool.name}`: {tool.description}")
        lines.append("")

    if agent.constitution:
        lines.extend(["## Constitution", ""])
        for i, principle in enumerate(agent.constitution, 1):
            lines.append(f"{i}. {principle}")
        lines.append("")

    if references:
        lines.extend(["## References", ""])
        for ref in references:
            lines.append(f"- {ref}")
        lines.append("")

    return "\n".join(lines)


def save_skill(
    agent: Agent,
    path: Union[str, Path],
    **kwargs: Any,
) -> None:
    """
    Save an Agent to a SKILL.md file.

    Args:
        agent: Agent to export
        path: Output path
        **kwargs: Additional arguments for agent_to_skill_md
    """
    path = Path(path)
    content = agent_to_skill_md(agent, **kwargs)
    path.write_text(content)


# Extension methods for Agent class
def _agent_from_skill(cls, path: Union[str, Path], **kwargs: Any) -> Agent:
    """Create an Agent from a SKILL.md file."""
    skill = load_skill(path)
    return skill_to_agent(skill, **kwargs)


def _agent_to_skill(self, path: Union[str, Path], **kwargs: Any) -> None:
    """Export this Agent to a SKILL.md file."""
    save_skill(self, path, **kwargs)


# Monkey-patch Agent class
Agent.from_skill = classmethod(_agent_from_skill)  # type: ignore
Agent.to_skill = _agent_to_skill  # type: ignore
