"""
MCP client implementation for connecting to MCP servers.
"""

import asyncio
import json
import subprocess
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union
from pathlib import Path

from autonomi.tool import Tool, ToolResult


@dataclass
class MCPConfig:
    """Configuration for an MCP server connection."""
    name: str
    command: str  # Command to start the server
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    working_dir: Optional[str] = None
    timeout: float = 30.0


@dataclass
class MCPServerInfo:
    """Information about a connected MCP server."""
    name: str
    version: str
    capabilities: List[str]
    tools: List[Dict[str, Any]]


class MCPClient:
    """
    Client for connecting to MCP (Model Context Protocol) servers.

    MCP servers provide tools that can be discovered and used by agents.
    This enables access to 10,000+ community tools.

    Example:
        client = MCPClient()
        await client.connect("filesystem", command="npx", args=["-y", "@anthropic/mcp-server-filesystem"])
        tools = await client.list_tools("filesystem")
    """

    def __init__(self) -> None:
        self._servers: Dict[str, MCPServerInfo] = {}
        self._processes: Dict[str, subprocess.Popen[bytes]] = {}
        self._tools: Dict[str, List[Tool]] = {}

    async def connect(
        self,
        name: str,
        command: str,
        args: Optional[List[str]] = None,
        env: Optional[Dict[str, str]] = None,
        working_dir: Optional[str] = None,
        timeout: float = 30.0,
    ) -> MCPServerInfo:
        """
        Connect to an MCP server.

        Args:
            name: Unique name for this connection
            command: Command to start the server
            args: Command arguments
            env: Environment variables
            working_dir: Working directory
            timeout: Connection timeout

        Returns:
            Server information including available tools
        """
        config = MCPConfig(
            name=name,
            command=command,
            args=args or [],
            env=env or {},
            working_dir=working_dir,
            timeout=timeout,
        )

        # Start the server process
        full_env = {**dict(subprocess.os.environ), **config.env}

        try:
            process = subprocess.Popen(
                [config.command] + config.args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=full_env,
                cwd=config.working_dir,
            )
            self._processes[name] = process

            # Initialize connection (send initialize request)
            init_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "autonomi-sdk",
                        "version": "0.1.0",
                    },
                },
            }

            response = await self._send_request(name, init_request, timeout)

            # Get server info
            server_info = MCPServerInfo(
                name=name,
                version=response.get("serverInfo", {}).get("version", "unknown"),
                capabilities=list(response.get("capabilities", {}).keys()),
                tools=[],
            )

            # List tools
            tools_response = await self._send_request(
                name,
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                timeout,
            )

            server_info.tools = tools_response.get("tools", [])
            self._servers[name] = server_info

            # Convert to Tool objects
            self._tools[name] = [
                self._mcp_tool_to_tool(name, t) for t in server_info.tools
            ]

            return server_info

        except Exception as e:
            # Clean up on failure
            if name in self._processes:
                self._processes[name].terminate()
                del self._processes[name]
            raise ConnectionError(f"Failed to connect to MCP server '{name}': {e}")

    async def _send_request(
        self,
        server_name: str,
        request: Dict[str, Any],
        timeout: float,
    ) -> Dict[str, Any]:
        """Send a JSON-RPC request to an MCP server."""
        if server_name not in self._processes:
            raise ValueError(f"Not connected to server '{server_name}'")

        process = self._processes[server_name]
        if process.stdin is None or process.stdout is None:
            raise ValueError(f"Server '{server_name}' stdin/stdout not available")

        # Send request
        request_bytes = (json.dumps(request) + "\n").encode()
        process.stdin.write(request_bytes)
        process.stdin.flush()

        # Read response (with timeout)
        loop = asyncio.get_event_loop()
        try:
            response_line = await asyncio.wait_for(
                loop.run_in_executor(None, process.stdout.readline),
                timeout=timeout,
            )
            response = json.loads(response_line.decode())

            if "error" in response:
                raise Exception(response["error"].get("message", "Unknown error"))

            return response.get("result", {})

        except asyncio.TimeoutError:
            raise TimeoutError(f"Timeout waiting for response from '{server_name}'")

    def _mcp_tool_to_tool(self, server_name: str, mcp_tool: Dict[str, Any]) -> Tool:
        """Convert an MCP tool definition to a Tool object."""
        tool_name = mcp_tool.get("name", "unknown")

        async def execute_mcp_tool(**kwargs: Any) -> Any:
            return await self.call_tool(server_name, tool_name, kwargs)

        return Tool(
            name=f"{server_name}:{tool_name}",
            description=mcp_tool.get("description", ""),
            function=execute_mcp_tool,
            schema=mcp_tool.get("inputSchema", {"type": "object", "properties": {}}),
            tags=["mcp", server_name],
        )

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Any:
        """
        Call a tool on an MCP server.

        Args:
            server_name: Name of the connected server
            tool_name: Name of the tool to call
            arguments: Tool arguments

        Returns:
            Tool execution result
        """
        request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        response = await self._send_request(server_name, request, timeout=60.0)
        return response.get("content", [])

    def list_tools(self, server_name: Optional[str] = None) -> List[Tool]:
        """
        List available tools.

        Args:
            server_name: Filter by server (None = all servers)

        Returns:
            List of Tool objects
        """
        if server_name:
            return self._tools.get(server_name, [])

        all_tools: List[Tool] = []
        for tools in self._tools.values():
            all_tools.extend(tools)
        return all_tools

    def get_server_info(self, name: str) -> Optional[MCPServerInfo]:
        """Get info about a connected server."""
        return self._servers.get(name)

    def list_servers(self) -> List[str]:
        """List connected servers."""
        return list(self._servers.keys())

    async def disconnect(self, name: str) -> None:
        """Disconnect from an MCP server."""
        if name in self._processes:
            self._processes[name].terminate()
            del self._processes[name]

        if name in self._servers:
            del self._servers[name]

        if name in self._tools:
            del self._tools[name]

    async def disconnect_all(self) -> None:
        """Disconnect from all MCP servers."""
        for name in list(self._processes.keys()):
            await self.disconnect(name)

    def __del__(self) -> None:
        """Clean up on deletion."""
        for process in self._processes.values():
            try:
                process.terminate()
            except Exception:
                pass


# Common MCP server configurations
MCP_SERVERS = {
    "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-filesystem", "/"],
    },
    "github": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-github"],
    },
    "postgres": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-postgres"],
    },
    "sqlite": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-sqlite"],
    },
    "puppeteer": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-puppeteer"],
    },
    "brave-search": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-brave-search"],
    },
    "fetch": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-fetch"],
    },
    "memory": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-memory"],
    },
}


async def connect_mcp_server(
    name: str,
    client: Optional[MCPClient] = None,
    **kwargs: Any,
) -> tuple[MCPClient, MCPServerInfo]:
    """
    Convenience function to connect to a known MCP server.

    Args:
        name: Server name (e.g., "filesystem", "github")
        client: Existing client (creates new if None)
        **kwargs: Override server config

    Returns:
        Tuple of (client, server_info)
    """
    if client is None:
        client = MCPClient()

    if name in MCP_SERVERS:
        config = {**MCP_SERVERS[name], **kwargs}
    else:
        config = kwargs

    info = await client.connect(
        name=name,
        command=config.get("command", ""),
        args=config.get("args", []),
        env=config.get("env", {}),
    )

    return client, info
