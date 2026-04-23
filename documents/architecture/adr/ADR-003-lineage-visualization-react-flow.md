# ADR-003: Lineage Visualization - React Flow with Dagre Layout

**Date:** April 18, 2026
**Status:** Accepted
**Author:** Provenance Platform Team

---

## Context

The platform requires an interactive lineage visualization to display the provenance graph for data products. The visualization must communicate directional data flow clearly (sources on the left, focal product in center, consumers on the right), handle graphs of up to 500 nodes at 60fps, and support expand/collapse for deep graphs.

D3 force-directed graph was the initially specified approach (F5.15 in PRD v1.3). During human walkthrough of the platform, the D3 force-directed implementation was rejected. The core problem is architectural: D3 force-directed layout is designed for exploratory network graphs where the spatial arrangement of nodes has no inherent meaning. Lineage graphs are directed acyclic graphs (DAGs) where spatial arrangement carries semantic meaning - upstream on the left, downstream on the right, time flows left to right. A force-directed layout obscures this directionality and produces different arrangements on every render, making the graph harder to reason about and impossible to navigate consistently.

---

## Decision

Replace D3 force-directed graph with React Flow using the Dagre layout algorithm.

**Layout specification:**
- Left-to-right directed layout using Dagre
- Upstream source nodes positioned on the left
- The focal data product positioned in the center
- Downstream consumer nodes positioned on the right
- Consistent, deterministic layout that does not change between renders

**Node card design:**
- Each node displays: product name, domain, and trust score
- Node type is visually encoded through card style (color, icon, or border)
- Non-determinism markers and lineage completeness indicators visible on node cards

**Edge design:**
- Edges labeled with relationship type (Derives From, Transforms, Consumes, Depends On, Supersedes)
- Edge source markers (declared, emitted, discovered) visually distinguished

**Interaction:**
- Expand/collapse at any node for deep graph navigation
- Click to focus - centers the graph on the selected node and recalculates visible neighborhood
- Pan and zoom
- Export to PNG and SVG

---

## Rationale

**React Flow** is the appropriate choice for this use case because:

1. It is purpose-built for node-based graph UIs in React, which is the platform's frontend framework
2. It has first-class support for the Dagre layout algorithm through the `@dagrejs/dagre` package and the `reactflow/layout` utilities
3. It renders at 60fps for graphs of the required scale through canvas-based rendering of edges with SVG node overlays
4. It provides expand/collapse patterns, custom node components, and custom edge rendering out of the box
5. Its API is TypeScript-native and integrates cleanly with the existing React + TypeScript frontend stack
6. It is actively maintained with a large community and commercial backing (xyflow)

**Dagre** is the appropriate layout algorithm because:

1. It produces deterministic left-to-right layouts for directed acyclic graphs
2. It minimizes edge crossings through its layered graph drawing algorithm
3. It handles the Provenance lineage graph structure naturally - sources in the leftmost layer, the focal product in a center layer, consumers in rightmost layers
4. It is the standard algorithm for representing data pipelines, dependency graphs, and workflow diagrams where direction carries semantic meaning

**Why not D3 force-directed:**

D3 force-directed layout was rejected because it is non-deterministic (the same graph renders differently each time), it does not communicate directionality (upstream/downstream), and it is designed for social network and cluster visualization, not DAG visualization. The visual result of a force-directed lineage graph is a tangled web that requires users to trace individual edges to understand relationships rather than reading the spatial layout.

---

## Consequences

**Positive:**
- Lineage graph communicates data flow direction immediately and intuitively
- Consistent layout means users can develop spatial memory for their lineage graphs
- React Flow's component model integrates cleanly with the existing React codebase
- Dagre layout handles the expand/collapse interaction pattern well

**Neutral:**
- React Flow has a dual license (MIT for open source use, commercial license for SaaS). Provenance is Apache 2.0 licensed open source software. Verification: React Flow (xyflow) is MIT licensed for open source projects. Commercial license applies to closed-source commercial use. Provenance's open source status means the MIT license applies. This should be reviewed if the business model changes.

**Negative:**
- React Flow adds a dependency to the frontend bundle. The bundle impact is acceptable given the complexity of the visualization requirement.
- D3 visualizations already built must be replaced. This is a targeted frontend change confined to the lineage visualization component.

---

## Implementation Notes

- Remove D3 and d3-force dependencies from the frontend package
- Install `reactflow` and `@dagrejs/dagre`
- The lineage graph data from the API (F5.14) maps directly to React Flow nodes and edges
- Node card components are standard React components passed to React Flow's `nodeTypes` prop
- The Dagre layout pass runs client-side before render; it is fast enough for 500 nodes
- Time travel mode (F5.17) renders a snapshot of the graph at a prior timestamp using the same React Flow component with historical data

---

*See F5.15 in Provenance_PRD_v1.4.md for the complete visualization requirements.*
*See NF5.8 and NF7.2 for performance requirements.*
