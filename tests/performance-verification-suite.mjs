// One process, one in-memory test credential; never write credentials to disk.
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
testAdminKey();
await import("./private-patches-remote.mjs");
await import("./performance-audit-remote.mjs");
await import("./search-realtime-remote.mjs");
