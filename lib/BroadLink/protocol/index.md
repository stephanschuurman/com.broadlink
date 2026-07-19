# BroadLink Protocol

This folder contains a TypeScript implementation of the BroadLink network protocol. It is the beginning of a **data model** in which every BroadLink packet type is modelled as its own typed class, built on a shared base. The goal is to gradually replace the ad-hoc packet handling in [Communicate.ts](../../Communicate.ts) with these strongly-typed packet classes.

### Update 2026/07/29
While working on this I ran into the problem that the existing protocol documentation was not very clear or complete. To get a better understanding I started writing my own [Wireshark dissector](https://github.com/stephanschuurman/broadlink-dissector) and used it to further dissect the protocol. The resulting (much more detailed) protocol description lives in that repository and forms the basis for the data model in this folder. This and other external documentation, tools, and example implementations are listed in [references.md](references.md).

## Folder Contents

| File | Description |
| --- | --- |
| [index.ts](index.ts) | Barrel file — re-exports all packet types for easy importing. |
| [types.ts](types.ts) | Shared protocol types: `BroadlinkPacket`, `BroadlinkHeader`, payload types. |
| [packet-base.ts](packet-base.ts) | `BroadlinkPacketBase` — abstract base class implementing the common wire format (magic header, GMT offset, checksums, …). |
| [encrypted-packet-base.ts](encrypted-packet-base.ts) | `BroadlinkEncryptedPacketBase` — base class for all non-hello packets: Command Extended Header + AES-128-CBC encrypted payload. |
| [hello-command.ts](hello-command.ts) | `HelloCommandPacket` — the discovery ("hello") broadcast sent to find devices. |
| [hello-response.ts](hello-response.ts) | `HelloResponsePacket` — the response a device sends to a hello broadcast. |
| [hello-response.test.ts](hello-response.test.ts) | Unit tests for the hello response packet. |
| [auth-command.ts](auth-command.ts) | `AuthCommandPacket` — the Auth Request (0x65): identifies the client to the device (encrypted with the default key). |
| [auth-response.ts](auth-response.ts) | `AuthResponsePacket` — the Auth Response (0x3e9): carries the assigned device ID and the AES session key. |
| [auth.test.ts](auth.test.ts) | Unit tests for the auth packets and the encrypted packet base. |
| [command-request.ts](command-request.ts) | `CommandRequestPacket` — Command Request (0x6a, new format for RM3*/RM4/RM5) with factories for learn/check/send IR-RF. |
| [command-response.ts](command-response.ts) | `CommandResponsePacket` — Command Response (0x3ee): echoes the command and carries command-specific data. |
| [command.test.ts](command.test.ts) | Unit tests for the command packets. |
| [raw-encrypted-packet.ts](raw-encrypted-packet.ts) | `RawEncryptedPacket` — encrypted packet with an opaque payload; generic transport used by `Communicate.ts` for the classic command format. |
| [old_example.js](old_example.js) | Legacy JavaScript example, kept for reference. |

## Data Model

The model follows the wire format of the BroadLink LAN protocol:

- Every packet consists of a fixed-size **header** and a variable-size **payload** (`BroadlinkPacket` in [types.ts](types.ts)).
- `BroadlinkPacketBase` implements the shared wire format (magic header, GMT offset, checksum calculation) once.
- Each concrete packet type (hello, auth, …) extends the base class and only adds its own fields and (de)serialization logic.

New packet types (auth response, discover, command/response payloads, …) will be added incrementally following the same pattern.