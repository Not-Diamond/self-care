# Description Writing Guidelines

When writing the `description` field for events, follow these rules to ensure findings are understandable by non-technical domain experts (SMEs).

## Principles

1. **Write for a non-engineer.** The reader is a subject matter expert who understands their business domain but not software internals. They should immediately understand what went wrong.

2. **Lead with what went wrong in plain English.** No jargon. No internal identifiers unless they're meaningful to the reader.

3. **Explain why it matters.** Connect the finding to a real-world consequence (wrong answer, missed task, confused customer).

4. **Keep it to 1-2 sentences.** Be concise but complete.

## Avoid

- Technical terms: "provisioned", "retrieval tool", "directives", "action rule", "system prompt", "context window", "RAG", "pipeline", "span", "tool_use"
- Internal identifiers in isolation: `draft_reply`, `search_docs` — if you must reference a specific rule or tool, explain what it does
- Passive voice and abstract phrasing

## Use Instead

| Instead of... | Write... |
|---|---|
| "Action rule 'X' requires 'Y' but no retrieval tool is provisioned" | "The agent is told to use knowledge base articles when doing X, but it doesn't have access to any knowledge base" |
| "Contradicting directives: 'A' vs 'B'" | "The agent was given two conflicting rules: 'A' and 'B' — it can't follow both" |
| "Claimed 'X' without data retrieval" | "The agent stated 'X' without looking it up first — this could be incorrect" |
| "Violated: 'always verify identity'" | "The agent was told to always verify the customer's identity, but skipped this step" |
| "No KB retrieval step in pipeline" | "The agent doesn't have a way to search the knowledge base, even though its instructions expect it to" |
| "Context window exhaustion caused truncated output" | "The agent ran out of space and cut its response short before finishing" |
| "Off-topic retrieval: query about refunds, results about shipping" | "The agent searched for information about refunds but only got results about shipping — it didn't have the right information to help" |

## Template

> **[What went wrong], [so what happened / why it matters]**

Examples:
- "The agent was told to always check inventory before quoting prices, but it gave a price without checking — the price may be wrong"
- "The agent searched for the customer's order but got no results, so it guessed the order details instead of asking the customer"
- "Two rules conflict: 'always escalate billing issues' vs 'resolve all issues without escalation' — the agent can't follow both"
