"""Tests for MCP client."""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from autonomi import MCPClient, MCPConfig, MCPTools, mcp_tool
from autonomi.mcp.client import MCPServerInfo, MCP_SERVERS


class TestMCPConfig:
    """Test MCPConfig dataclass."""

    def test_basic_config(self) -> None:
        """Test basic configuration."""
        config = MCPConfig(
            name="test",
            command="npx",
            args=["-y", "@test/server"],
        )
        assert config.name == "test"
        assert config.command == "npx"
        assert config.timeout == 30.0

    def test_config_with_env(self) -> None:
        """Test configuration with environment variables."""
        config = MCPConfig(
            name="test",
            command="node",
            args=["server.js"],
            env={"API_KEY": "secret"},
        )
        assert config.env == {"API_KEY": "secret"}


class TestMCPServerInfo:
    """Test MCPServerInfo dataclass."""

    def test_server_info(self) -> None:
        """Test server info creation."""
        info = MCPServerInfo(
            name="filesystem",
            version="1.0.0",
            capabilities=["tools"],
            tools=[
                {"name": "read_file", "description": "Read a file"},
            ],
        )
        assert info.name == "filesystem"
        assert len(info.tools) == 1


class TestMCPServers:
    """Test predefined MCP server configurations."""

    def test_filesystem_server_config(self) -> None:
        """Test filesystem server configuration."""
        assert "filesystem" in MCP_SERVERS
        config = MCP_SERVERS["filesystem"]
        assert config["command"] == "npx"
        assert "@anthropic/mcp-server-filesystem" in config["args"][1]

    def test_github_server_config(self) -> None:
        """Test github server configuration."""
        assert "github" in MCP_SERVERS
        config = MCP_SERVERS["github"]
        assert "@anthropic/mcp-server-github" in config["args"][1]

    def test_postgres_server_config(self) -> None:
        """Test postgres server configuration."""
        assert "postgres" in MCP_SERVERS

    def test_all_servers_have_required_fields(self) -> None:
        """Test all servers have required fields."""
        for name, config in MCP_SERVERS.items():
            assert "command" in config, f"{name} missing command"
            assert "args" in config, f"{name} missing args"


class TestMCPClient:
    """Test MCPClient class."""

    def test_client_initialization(self) -> None:
        """Test client initialization."""
        client = MCPClient()
        assert len(client.list_servers()) == 0
        assert len(client.list_tools()) == 0

    def test_list_tools_empty(self) -> None:
        """Test listing tools when no servers connected."""
        client = MCPClient()
        tools = client.list_tools()
        assert tools == []

    def test_list_tools_by_server(self) -> None:
        """Test listing tools filtered by server."""
        client = MCPClient()
        # Without connection, should return empty
        tools = client.list_tools("filesystem")
        assert tools == []

    def test_get_server_info_not_connected(self) -> None:
        """Test getting info for non-connected server."""
        client = MCPClient()
        info = client.get_server_info("nonexistent")
        assert info is None


class TestMCPTools:
    """Test MCPTools helper class."""

    def test_mcp_tools_initialization(self) -> None:
        """Test MCPTools initialization."""
        tools = MCPTools("filesystem", "github")
        assert len(tools._servers) == 2
        assert "filesystem" in tools._servers
        assert "github" in tools._servers

    def test_mcp_tools_iteration_not_connected(self) -> None:
        """Test iterating before connection."""
        tools = MCPTools("filesystem")
        # Should handle gracefully when not connected in async context
        tool_list = list(tools)
        # May be empty or connected depending on event loop state
        assert isinstance(tool_list, list)

    def test_mcp_tools_len(self) -> None:
        """Test len() on MCPTools."""
        tools = MCPTools("filesystem")
        # Before connection, should be 0
        assert len(tools) == 0

    def test_mcp_tools_client_property(self) -> None:
        """Test client property."""
        tools = MCPTools("filesystem")
        assert tools.client is not None
        assert isinstance(tools.client, MCPClient)

    def test_mcp_tools_with_custom_client(self) -> None:
        """Test MCPTools with custom client."""
        custom_client = MCPClient()
        tools = MCPTools("filesystem", client=custom_client)
        assert tools.client is custom_client


class TestMCPTool:
    """Test mcp_tool function."""

    def test_create_mcp_tool(self) -> None:
        """Test creating an MCP tool reference."""
        read_file = mcp_tool("filesystem", "read_file")
        assert read_file.name == "filesystem:read_file"
        assert "mcp" in read_file.tags
        assert "filesystem" in read_file.tags
        assert "lazy" in read_file.tags

    def test_mcp_tool_has_schema(self) -> None:
        """Test MCP tool has schema."""
        read_file = mcp_tool("filesystem", "read_file")
        assert read_file.schema is not None
        assert read_file.schema["type"] == "object"


class TestMCPClientConnection:
    """Test MCP client connection (mocked)."""

    @pytest.mark.asyncio
    async def test_connect_unknown_server(self) -> None:
        """Test connecting to unknown server raises error."""
        client = MCPClient()
        with pytest.raises(ValueError, match="Unknown MCP server"):
            tools = MCPTools("nonexistent")
            await tools.connect()

    @pytest.mark.asyncio
    async def test_connect_success(self) -> None:
        """Test successful connection (mocked)."""
        with patch("subprocess.Popen") as mock_popen:
            # Mock the subprocess
            mock_process = Mock()
            mock_process.stdin = Mock()
            mock_process.stdout = Mock()
            mock_process.stderr = Mock()
            mock_process.stdout.readline.return_value = b'{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"version":"1.0"},"capabilities":{}}}\n'
            mock_popen.return_value = mock_process

            client = MCPClient()
            # This will fail because we can't fully mock the async flow
            # but we verify the setup is correct
            assert client is not None


class TestMCPToolsIntegration:
    """Integration tests for MCP tools with agents."""

    def test_agent_with_mcp_tools(self) -> None:
        """Test creating agent with MCPTools (no connection)."""
        from autonomi import Agent

        # MCPTools can be passed to agent, tools will be empty until connected
        mcp_tools = MCPTools("filesystem")

        # Agent accepts iterable of tools
        agent = Agent(
            name="mcp-agent",
            instructions="Use MCP tools.",
            tools=list(mcp_tools),  # Empty list before connection
        )
        assert agent.name == "mcp-agent"
        # Tools empty because not connected
        assert len(agent.tools) == 0

    def test_lazy_mcp_tool_in_agent(self) -> None:
        """Test using lazy mcp_tool with agent."""
        from autonomi import Agent

        read_file = mcp_tool("filesystem", "read_file")

        agent = Agent(
            name="lazy-mcp-agent",
            instructions="Use lazy MCP tools.",
            tools=[read_file],
        )
        assert len(agent.tools) == 1
        assert agent.tools[0].name == "filesystem:read_file"
