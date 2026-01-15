"""Tests for the Tool primitive."""

import pytest
from autonomi import tool, Tool, ToolResult, ToolError, ToolRegistry


class TestToolDecorator:
    """Test the @tool decorator."""

    def test_basic_tool_creation(self) -> None:
        """Test creating a tool from a simple function."""

        @tool
        def greet(name: str) -> str:
            """Greet a person by name."""
            return f"Hello, {name}!"

        assert isinstance(greet, Tool)
        assert greet.name == "greet"
        assert "Greet a person" in greet.description

    def test_tool_with_custom_name(self) -> None:
        """Test tool with custom name."""

        @tool(name="custom_greeter")
        def greet(name: str) -> str:
            """Greet a person."""
            return f"Hi, {name}!"

        assert greet.name == "custom_greeter"

    def test_tool_schema_generation(self) -> None:
        """Test automatic schema generation from type hints."""

        @tool
        def add_numbers(a: int, b: int) -> int:
            """Add two numbers together."""
            return a + b

        schema = add_numbers.schema
        assert schema["type"] == "object"
        assert "a" in schema["properties"]
        assert "b" in schema["properties"]
        assert schema["properties"]["a"]["type"] == "integer"
        assert schema["properties"]["b"]["type"] == "integer"

    def test_tool_with_default_params(self) -> None:
        """Test tool with default parameters."""

        @tool
        def greet(name: str, greeting: str = "Hello") -> str:
            """Greet with custom greeting."""
            return f"{greeting}, {name}!"

        schema = greet.schema
        assert "name" in schema["required"]
        assert "greeting" not in schema.get("required", [])

    def test_tool_execution(self) -> None:
        """Test tool execution."""

        @tool
        def multiply(x: int, y: int) -> int:
            """Multiply two numbers."""
            return x * y

        result = multiply(x=3, y=4)
        assert result == 12

    def test_async_tool(self) -> None:
        """Test async tool creation."""
        import asyncio

        @tool
        async def async_greet(name: str) -> str:
            """Async greeting."""
            await asyncio.sleep(0)
            return f"Hello, {name}!"

        assert isinstance(async_greet, Tool)
        assert async_greet.name == "async_greet"

    def test_tool_with_tags(self) -> None:
        """Test tool with tags."""

        @tool(tags=["filesystem", "read"])
        def read_file(path: str) -> str:
            """Read a file."""
            return "content"

        assert "filesystem" in read_file.tags
        assert "read" in read_file.tags


class TestToolRegistry:
    """Test the ToolRegistry class."""

    def test_register_tool(self) -> None:
        """Test registering a tool."""
        registry = ToolRegistry()

        @tool
        def my_tool(x: int) -> int:
            """A tool."""
            return x

        registry.register(my_tool)
        assert len(registry) == 1

    def test_register_function(self) -> None:
        """Test registering a plain function."""
        registry = ToolRegistry()

        def my_func(x: int) -> int:
            """A function."""
            return x

        registry.register(my_func)
        assert len(registry) == 1

    def test_search_by_tags(self) -> None:
        """Test searching tools by tags."""
        registry = ToolRegistry()

        @tool(tags=["filesystem"])
        def read_file(path: str) -> str:
            """Read file."""
            return ""

        @tool(tags=["database"])
        def query_db(sql: str) -> str:
            """Query database."""
            return ""

        registry.register(read_file)
        registry.register(query_db)

        fs_tools = registry.search(tags=["filesystem"])
        assert len(fs_tools) == 1
        assert fs_tools[0].name == "read_file"

    def test_search_by_query(self) -> None:
        """Test searching tools by query."""
        registry = ToolRegistry()

        @tool
        def read_file(path: str) -> str:
            """Read contents of a file."""
            return ""

        @tool
        def write_file(path: str, content: str) -> None:
            """Write content to a file."""
            pass

        registry.register(read_file)
        registry.register(write_file)

        results = registry.search(query="read")
        assert len(results) >= 1

    def test_get_tool_by_name(self) -> None:
        """Test getting tool by name."""
        registry = ToolRegistry()

        @tool
        def my_tool(x: int) -> int:
            """A tool."""
            return x

        registry.register(my_tool)
        found = registry.get("my_tool")
        assert found is not None
        assert found.name == "my_tool"


class TestToolResult:
    """Test ToolResult class."""

    def test_success_result(self) -> None:
        """Test successful tool result."""
        result = ToolResult(
            success=True,
            output="Hello, World!",
            tool_name="greet",
        )
        assert result.success is True
        assert result.output == "Hello, World!"
        assert result.error is None

    def test_error_result(self) -> None:
        """Test error tool result."""
        result = ToolResult(
            success=False,
            output=None,
            tool_name="greet",
            error="File not found",
        )
        assert result.success is False
        assert result.error == "File not found"


class TestToolError:
    """Test ToolError exception."""

    def test_tool_error_creation(self) -> None:
        """Test creating a tool error."""
        error = ToolError(
            tool_name="read_file",
            message="File not found",
        )
        assert error.tool_name == "read_file"
        assert "File not found" in str(error)

    def test_tool_error_with_cause(self) -> None:
        """Test tool error with cause."""
        cause = FileNotFoundError("test.txt")
        error = ToolError(
            tool_name="read_file",
            message="Failed to read file",
            cause=cause,
        )
        assert error.cause is cause
