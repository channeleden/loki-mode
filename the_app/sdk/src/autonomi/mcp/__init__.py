"""
MCP (Model Context Protocol) client for the Autonomi SDK.

Enables connecting to MCP servers for tool discovery and execution.
"""

from autonomi.mcp.client import MCPClient, MCPConfig
from autonomi.mcp.tools import MCPTools, mcp_tool

__all__ = [
    "MCPClient",
    "MCPConfig",
    "MCPTools",
    "mcp_tool",
]
