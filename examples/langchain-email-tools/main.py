"""
LangChain Email Tools — Demo Agent

Creates a LangChain ReAct agent with Pigeons email tools and runs
example prompts to demonstrate sending, checking, and managing email
through natural language.

Run: python main.py
"""

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent

from tools import pigeons_tools

load_dotenv()

# ── Set up the agent ───────────────────────────────────────────────────────

llm = ChatAnthropic(model="claude-sonnet-4-20250514")

agent = create_react_agent(llm, pigeons_tools)

# ── Example prompts ────────────────────────────────────────────────────────

prompts = [
    "Send a welcome email to user@example.com with the subject 'Welcome to Pigeons' and a short HTML greeting.",
    "Check the status of email msg_123.",
    "List all contacts tagged 'vip'.",
]


def run_prompt(prompt: str) -> None:
    """Run a single prompt through the agent and print the response."""
    print(f">>> {prompt}\n")

    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})

    # The last message in the result is the agent's final answer.
    final_message = result["messages"][-1]
    print(f"{final_message.content}\n")
    print("-" * 72)
    print()


def main() -> None:
    print("=" * 72)
    print("  Pigeons + LangChain Email Agent")
    print("=" * 72)
    print()

    for prompt in prompts:
        run_prompt(prompt)


if __name__ == "__main__":
    main()
