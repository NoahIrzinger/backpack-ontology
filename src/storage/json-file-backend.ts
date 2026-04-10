// JsonFileBackend is an alias for EventSourcedBackend.
//
// The original JsonFileBackend stored each graph as a single monolithic
// JSON file under branches/<branch>.json. That implementation was
// replaced by event-sourced storage in v0.3.0 (Phase 2 of the
// architectural reset). The class name is preserved for backward
// compatibility with downstream consumers like backpack-viewer that
// import { JsonFileBackend } from the package.
//
// New code should prefer EventSourcedBackend directly.

export { EventSourcedBackend as JsonFileBackend } from "./event-sourced-backend.js";
