//! `viscosity-live-re`: stdio MCP server that drives LLDB through lldb-dap
//! (the Debug Adapter Protocol) so coding agents can debug running programs.
//!
//! - `mcp`: JSON-RPC framing, version negotiation, tool dispatch
//! - `tools`: the `re_*` tool catalog and argument validation
//! - `session`: one lldb-dap child per debug session
//! - `dap`: DAP client (framing, seq matching, timeouts, event buffers)
//! - `host`: debugger discovery, device tooling, process/device lists
//! - `version`: protocol constants mirrored in the TypeScript host

pub mod dap;
pub mod host;
pub mod mcp;
pub mod session;
pub mod tools;
pub mod version;

pub use version::TOOLS_PROTOCOL_VERSION;
