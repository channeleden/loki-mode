"""Tests for SKILL.md import/export."""

import pytest
import tempfile
from pathlib import Path
from autonomi import (
    SkillDefinition,
    parse_skill_md,
    load_skill,
    save_skill,
    skill_to_agent,
    agent_to_skill_md,
    Agent,
    tool,
)


class TestSkillDefinition:
    """Test SkillDefinition dataclass."""

    def test_default_values(self) -> None:
        """Test default values."""
        skill = SkillDefinition(name="test")
        assert skill.name == "test"
        assert skill.version == "1.0.0"
        assert skill.model == "claude-sonnet-4-20250514"
        assert skill.tools == []
        assert skill.constitution == []

    def test_custom_values(self) -> None:
        """Test custom values."""
        skill = SkillDefinition(
            name="custom",
            version="2.0.0",
            description="A custom skill",
            instructions="Do something",
            model="claude-opus-4-5",
            tools=["tool1", "tool2"],
            constitution=["Rule 1", "Rule 2"],
        )
        assert skill.name == "custom"
        assert skill.version == "2.0.0"
        assert skill.description == "A custom skill"
        assert len(skill.tools) == 2


class TestParseSkillMd:
    """Test parsing SKILL.md content."""

    def test_parse_basic_skill(self) -> None:
        """Test parsing basic skill file."""
        content = """# My Skill

A helpful assistant.

## Instructions

You are a helpful assistant that answers questions.
"""
        skill = parse_skill_md(content)
        assert skill.name == "My Skill"
        assert "helpful assistant" in skill.description
        assert "answers questions" in skill.instructions

    def test_parse_with_frontmatter(self) -> None:
        """Test parsing with YAML frontmatter."""
        content = """---
name: custom-agent
version: 2.0.0
model: claude-opus-4-5
triggers:
  - "help me"
  - "assist with"
---

# Custom Agent

An agent with frontmatter.

## Instructions

Do helpful things.
"""
        skill = parse_skill_md(content)
        assert skill.name == "custom-agent"
        assert skill.version == "2.0.0"
        assert skill.model == "claude-opus-4-5"
        assert "help me" in skill.triggers

    def test_parse_tools_section(self) -> None:
        """Test parsing tools section."""
        content = """# Tool Agent

## Tools

- `read_file`: Read contents of a file
- `write_file`: Write to a file
- search_code

## Instructions

Use tools to help.
"""
        skill = parse_skill_md(content)
        assert "read_file" in skill.tools
        assert "write_file" in skill.tools
        assert "search_code" in skill.tools

    def test_parse_constitution_section(self) -> None:
        """Test parsing constitution/principles section."""
        content = """# Principled Agent

## Constitution

1. Never expose secrets
2. Always validate input
3. Prefer simple solutions

## Instructions

Follow the principles.
"""
        skill = parse_skill_md(content)
        assert len(skill.constitution) == 3
        assert "Never expose secrets" in skill.constitution[0]

    def test_parse_references_section(self) -> None:
        """Test parsing references section."""
        content = """# Referenced Agent

## Instructions

Do things.

## References

- https://docs.example.com
- Project README
"""
        skill = parse_skill_md(content)
        assert len(skill.references) == 2


class TestSkillToAgent:
    """Test converting skill to agent."""

    def test_basic_conversion(self) -> None:
        """Test basic skill to agent conversion."""
        skill = SkillDefinition(
            name="test-agent",
            instructions="You are a test agent.",
            model="claude-sonnet-4-5",
        )
        agent = skill_to_agent(skill)
        assert agent.name == "test-agent"
        assert agent.instructions == "You are a test agent."
        assert agent.model == "claude-sonnet-4-5"

    def test_conversion_with_constitution(self) -> None:
        """Test conversion preserves constitution."""
        skill = SkillDefinition(
            name="principled",
            instructions="Be principled.",
            constitution=["Rule 1", "Rule 2"],
        )
        agent = skill_to_agent(skill)
        assert agent.constitution == ["Rule 1", "Rule 2"]

    def test_conversion_with_tools(self) -> None:
        """Test conversion with tools."""

        @tool
        def greet(name: str) -> str:
            """Greet someone."""
            return f"Hello, {name}!"

        skill = SkillDefinition(
            name="tool-agent",
            instructions="Use tools.",
        )
        agent = skill_to_agent(skill, tools=[greet])
        assert len(agent.tools) == 1


class TestAgentToSkillMd:
    """Test exporting agent to SKILL.md."""

    def test_basic_export(self) -> None:
        """Test basic agent export."""
        agent = Agent(
            name="test-agent",
            instructions="You are a test agent.",
            model="claude-sonnet-4-5",
        )
        md = agent_to_skill_md(agent, description="A test agent")
        assert "# test-agent" in md
        assert "A test agent" in md
        assert "## Instructions" in md
        assert "You are a test agent." in md

    def test_export_with_frontmatter(self) -> None:
        """Test export includes YAML frontmatter."""
        agent = Agent(
            name="test-agent",
            instructions="Test instructions.",
            model="claude-opus-4-5",
        )
        md = agent_to_skill_md(agent, version="2.0.0")
        assert "---" in md
        assert "name: test-agent" in md
        assert "version: 2.0.0" in md
        assert "model: claude-opus-4-5" in md

    def test_export_with_tools(self) -> None:
        """Test export includes tools section."""

        @tool
        def greet(name: str) -> str:
            """Greet someone by name."""
            return f"Hello, {name}!"

        agent = Agent(
            name="tool-agent",
            instructions="Use tools.",
            tools=[greet],
        )
        md = agent_to_skill_md(agent)
        assert "## Tools" in md
        assert "greet" in md

    def test_export_with_constitution(self) -> None:
        """Test export includes constitution section."""
        agent = Agent(
            name="principled",
            instructions="Be principled.",
            constitution=["Never lie", "Always help"],
        )
        md = agent_to_skill_md(agent)
        assert "## Constitution" in md
        assert "Never lie" in md
        assert "Always help" in md


class TestLoadSaveSkill:
    """Test loading and saving skill files."""

    def test_load_skill_file(self) -> None:
        """Test loading skill from file."""
        content = """---
name: file-agent
version: 1.0.0
---

# File Agent

An agent from a file.

## Instructions

Do file things.
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            f.write(content)
            f.flush()
            path = f.name

        try:
            skill = load_skill(path)
            assert skill.name == "file-agent"
            assert skill.version == "1.0.0"
        finally:
            Path(path).unlink()

    def test_save_agent_to_skill_file(self) -> None:
        """Test saving agent to skill file."""
        agent = Agent(
            name="saved-agent",
            instructions="Saved agent instructions.",
            constitution=["Be good"],
        )

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            path = f.name

        try:
            save_skill(agent, path, description="A saved agent")

            # Reload and verify
            skill = load_skill(path)
            assert skill.name == "saved-agent"
            assert "Saved agent instructions" in skill.instructions
        finally:
            Path(path).unlink()


class TestAgentSkillMethods:
    """Test Agent class skill methods."""

    def test_agent_from_skill(self) -> None:
        """Test Agent.from_skill class method."""
        content = """---
name: from-skill-agent
model: claude-sonnet-4-5
---

# From Skill Agent

## Instructions

Created from a skill file.
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            f.write(content)
            f.flush()
            path = f.name

        try:
            agent = Agent.from_skill(path)
            assert agent.name == "from-skill-agent"
            assert agent.model == "claude-sonnet-4-5"
        finally:
            Path(path).unlink()

    def test_agent_to_skill(self) -> None:
        """Test Agent.to_skill instance method."""
        agent = Agent(
            name="to-skill-agent",
            instructions="Export me to a skill.",
        )

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            path = f.name

        try:
            agent.to_skill(path, description="Exported agent")

            # Verify file exists and contains expected content
            content = Path(path).read_text()
            assert "# to-skill-agent" in content
            assert "Exported agent" in content
        finally:
            Path(path).unlink()
