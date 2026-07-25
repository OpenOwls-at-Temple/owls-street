# Architecture Planning & Layering Spec

This document details the architectural boundaries and dependency constraints of the Owl Street monorepo to ensure clear runtime decoupling.

## Layering Rules

The monorepo contains two distinct backend-backed services. To maintain high system health and clean separation of concerns, the following boundaries are enforced:

1. **Downward Direction of Dependency**:
   * `owl-street-view` (the dashboard API/proxy) **depends on** and communicates with `owl-street-pulse` (the Alert/Chat server).
   * `owl-street-pulse` **must never** depend on, import from, or call `owl-street-view`. It is a standalone background alert calculating daemon and LLM context provider.

2. **Communication Protocols**:
   * Services communicate via **HTTP API calls** and standard networking formats (REST payloads, JSON data).
   * They must not share code files, modules, or standard runtime imports (e.g. they utilize separate virtual environments and distinct package dependency scopes).

## State and Data Ownership

1. **SQLite Database Ownership**:
   * The Alert state database (`alerts.db`) is fully **owned** by the `owl-street-pulse` package. The Pulse engine manages the writing, updating, and cleanup of historical triggers.
   * While the `owl-street-view` proxy can connect to or query the database for historical displays, it must treat the records as **read-only** and never modify trigger states.

2. **External Ingest Boundaries**:
   * Both services interface with Alpaca, but they serve separate contexts:
     * `owl-street-pulse`: Continuous polling of technical candle indicators.
     * `owl-street-view`: Direct user order placement, option chains matrix building, and WebSocket live streaming.
