# Autonomi SDK Examples

This directory contains example scripts demonstrating the Autonomi SDK capabilities.

## Examples

| File | Description |
|------|-------------|
| `01_hello_world.py` | Simplest possible agent in 5 lines |
| `02_tools.py` | Creating agents with custom tools |
| `03_guardrails.py` | Input/output guardrails for safety |
| `04_orchestration.py` | Multi-agent coordination patterns |
| `05_checkpointing.py` | Workflow recovery with checkpoints |
| `06_skill_import.py` | SKILL.md import and export |
| `07_providers_and_cost.py` | Multi-provider support and cost tracking |

## Running Examples

1. Install the SDK:
   ```bash
   cd the_app/sdk
   pip install -e ".[dev]"
   ```

2. Set environment variables (if using cloud providers):
   ```bash
   export ANTHROPIC_API_KEY="your-key"
   export OPENAI_API_KEY="your-key"
   ```

3. Run an example:
   ```bash
   python examples/01_hello_world.py
   ```

## Prerequisites

- Python 3.10+
- API keys for cloud providers (optional - some examples work locally)
- For local models: Ollama installed and running

## Quick Start

The simplest way to get started:

```python
from autonomi import Agent

agent = Agent(
    name="assistant",
    instructions="You are a helpful assistant."
)

result = await agent.execute("Hello!")
print(result.content)
```

## Learn More

- Full documentation: https://docs.autonomi.dev/sdk
- API reference: https://docs.autonomi.dev/sdk/api
- GitHub: https://github.com/autonomi/autonomi-sdk
