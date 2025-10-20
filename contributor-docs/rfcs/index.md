# RFCs (Requests for Comments)

This directory contains design documents for significant LiveStore features and architectural changes. RFCs provide a structured way to propose, discuss, and document major decisions before implementation.

## Purpose

RFCs serve multiple purposes:

1. **Design Documentation**: Capture the rationale behind major features and architectural decisions
2. **Discussion Forum**: Provide a focal point for community feedback and iteration
3. **Historical Record**: Document why certain approaches were chosen (and rejected alternatives)
4. **Implementation Guide**: Serve as detailed specifications for implementers

## When to Write an RFC

Consider writing an RFC for changes that:

- Introduce new public APIs or significantly change existing ones
- Affect multiple packages or core architecture
- Require coordination across contributors
- Have meaningful trade-offs or alternative approaches
- Impact performance, compatibility, or migration paths

Small bug fixes, documentation improvements, and internal refactoring typically don't need RFCs.

## RFC Process

### 1. Draft

Create a new RFC by copying the template and name it with the next sequential number and a descriptive name:

```bash
# Create a new RFC with the next sequential number
docs/src/content/rfcs/NNNN-descriptive-name.md
```

Include:
- **Context**: Just enough context necessary to frame the rest of the RFC. The content should be indisputable facts, not opinions.
- **Problem**: A description of the problem that this RFC is trying to address, the constraints, and why this problem is worth solving now.
- **Proposed Solution**: Detailed API design with examples.
- **Alternatives Considered**: What other approaches were considered and why they were not chosen.
- **Open Questions**: Any unresolved issues or areas where feedback is specifically requested.

### 2. Review

1. Open a pull request with the RFC
2. Share in relevant GitHub issues or discussions
3. Incorporate feedback through commits to the PR
4. Iterate until consensus is reached

### 3. Acceptance

Once the RFC has been reviewed and refined:
- Merge the PR to formally accept the RFC
- Implementation can begin
