import { parseAbiParameters } from "viem"

/** Must match the abi.decode in HallMonitor.onReport. */
export const AUDIT_REPORT = parseAbiParameters(
  "string url, uint64 observedAt, bytes32 evidenceHash, string[] hosts, uint8[] categories, uint8[] severities",
)

/** Read-side ABI used by tools/verify.ts. */
export const HallMonitorAbi = [
  {
    type: "function",
    name: "getPage",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "url", type: "string" },
      { name: "firstAuditAt", type: "uint64" },
      { name: "lastAuditAt", type: "uint64" },
      { name: "audited", type: "uint32" },
      { name: "hosts", type: "string[]" },
    ],
  },
  {
    type: "function",
    name: "getTracker",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "host", type: "string" },
    ],
    outputs: [
      {
        name: "t",
        type: "tuple",
        components: [
          { name: "firstSeen", type: "uint64" },
          { name: "lastSeen", type: "uint64" },
          { name: "observations", type: "uint32" },
          { name: "category", type: "uint8" },
          { name: "severity", type: "uint8" },
        ],
      },
      { name: "active", type: "bool" },
      { name: "persistedSeconds", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "audits",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "pageId", type: "bytes32" },
      { name: "observedAt", type: "uint64" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "trackerCount", type: "uint16" },
      { name: "highCount", type: "uint16" },
    ],
  },
  {
    type: "function",
    name: "auditsFor",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
] as const
