"""
MCP tools integration for agents.
"""

from typing import Any, List, Optional, Union

from autonomi.tool import Tool
from autonomi.mcp.client import MCPClient, MCP_SERVERS


class MCPTools:
    """
    Helper class for adding MCP server tools to agents.

    Example:
        from autonomi import Agent, MCPTools

        agent = Agent(
            name="assistant",
            tools=MCPTools("filesystem", "github")
        )
    """

    def __init__(self, *servers: str, client: Optional[MCPClient] = None):
        """
        Initialize MCPTools with specified servers.

        Args:
            *servers: Server names to connect to
            client: Optional existing MCPClient
        """
        self._servers = list(servers)
        self._client = client or MCPClient()
        self._connected = False
        self._tools: List[Tool] = []

    async def connect(self) -> List[Tool]:
        """Connect to all servers and return tools."""
        if self._connected:
            return self._tools

        for server_name in self._servers:
            try:
                if server_name in MCP_SERVERS:
                    config = MCP_SERVERS[server_name]
                    await self._client.connect(
                        name=server_name,
                        command=config["command"],
                        args=config["args"],
                    )
                else:
                    raise ValueError(f"Unknown MCP server: {server_name}")
            except Exception as e:
                print(f"Warning: Failed to connect to {server_name}: {e}")

        self._tools = self._client.list_tools()
        self._connected = True
        return self._tools

    def __iter__(self):
        """Iterate over tools (connects synchronously if needed)."""
        import asyncio
        if not self._connected:
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            if loop.is_running():
                # Can't connect synchronously in async context
                return iter([])
            else:
                loop.run_until_complete(self.connect())

        return iter(self._tools)

    def __len__(self) -> int:
        return len(self._tools)

    @property
    def client(self) -> MCPClient:
        """Get the underlying MCP client."""
        return self._client

    async def disconnect(self) -> None:
        """Disconnect from all servers."""
        await self._client.disconnect_all()
        self._connected = False
        self._tools = []


def mcp_tool(server: str, tool_name: str) -> Tool:
    """
    Create a single MCP tool reference.

    This creates a lazy tool that connects to the server
    only when first called.

    Example:
        read_file = mcp_tool("filesystem", "read_file")
        agent = Agent(tools=[read_file])
    """
    _client: Optional[MCPClient] = None
    _connected = False

    async def execute(**kwargs: Any) -> Any:
        nonlocal _client, _connected

        if not _connected:
            _client = MCPClient()
            if server in MCP_SERVERS:
                config = MCP_SERVERS[server]
                await _client.connect(
                    name=server,
                    command=config["command"],
                    args=config["args"],
                )
            _connected = True

        if _client is None:
            raise RuntimeError("MCP client not initialized")

        return await _client.call_tool(server, tool_name, kwargs)

    return Tool(
        name=f"{server}:{tool_name}",
        description=f"MCP tool from {server} server",
        function=execute,
        schema={"type": "object", "properties": {}},
        tags=["mcp", server, "lazy"],
    )
