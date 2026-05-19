# Copilot-Harness Framework Documentation

This directory is the local, curated file architecture for the current framework. It consolidates
Notion planning, market research, adopted architecture decisions, and landed repository evidence
without moving the original phase closure files.

## Reading Order

1. `01-notion-source-map.md`
   Understand which Notion pages are source inputs, current baselines, or historical/background
   material.
2. `02-market-benchmark-and-adopted-decisions.md`
   See the market practices that shaped the framework and the concrete decisions adopted locally.
3. `03-architecture-blueprint.md`
   Read the current architecture, runtime boundaries, gates, MCP layers, Memory, Auto-Memory,
   Fleet/Arena, and Showcase shape.
4. `04-roadmap-and-phase-plan.md`
   Follow the W0-W19+ phase plan and status.
5. `05-implementation-artifacts.md`
   Check what has actually landed in the repository and which evidence proves it.
6. `06-operating-boundaries-and-next-steps.md`
   Use this for release/cutover planning, blockers, and next actions.

## Current Position

Copilot-Harness has a working control-plane and shadow/readiness evidence base:

- Phase 0 and Phase 1 are complete by local evidence.
- Phase 2 has local/mock/contract closure, but live Runner CI and real Memory cutover are still
  blocked.
- Phase 3 has W14-W18 shadow/readiness artifacts, but production write-back remains NO-GO.

The short rule for future planning:

> Treat the framework as ready for controlled analysis, evidence building, and management
> readiness. Do not treat it as production write-back ready until RB-1 and RB-2 are closed.

## Directory Policy

Historical files remain in place because they are evidence anchors. New synthesis docs should be
added here rather than rewriting phase closure reports.
