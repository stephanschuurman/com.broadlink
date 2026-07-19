/**
 * Shared Broadlink protocol types.
 *
 * Copyright 2026, Stephan Schuurman (stephanschuurman.com)
 *
 * This file is part of com.broadlink
 * com.broadlink is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * com.broadlink is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with com.broadlink.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

/**
 * Interface representing a complete BroadLink packet, consisting of a header and a payload.
 *
 * A BroadLink packet is the fundamental unit of communication between a BroadLink device and a client.
 * It consists of a fixed-size header followed by a variable-size payload, which contains the actual data being transmitted.
 *
 * @interface BroadlinkPacket
 */
export interface BroadlinkPacket {
  header:  BroadlinkHeader;
  payload: BroadlinkPayload;
}

export interface BroadlinkHeader {
  magicHeader: Buffer;  // always 0x5a 0xa5 0xaa 0x55 0x5a 0xa5 0xaa 0x55
  timestamp:     Date;    // current date/time (used in discovery packets to calculate timezone offset)
  srcIp:       string;  // e.g. "192.168.1.10"
  srcPort:     number;  // UDP source port number
  checksum:    number;  // 16-bit checksum calculated as (0xbeaf + sum of all bytes) & 0xffff
  checksumValid?: boolean; // calculated checksum matches header checksum (added by decodePacket)
  errorCode:   number;  // always 0 in discovery packets
  deviceType:  number;  // always 0 in discovery packets
  payloadType: PayloadType.Command | PayloadType.Response;
  packetCount: number;  // always 0 for discovery packets
  macAddress:  string;  // e.g. "01:23:45:67:89:ab"
}

/**
 * Discriminated union of all known payload shapes.
 *
 * Each structured payload carries a `payloadType` discriminant so TypeScript can
 * narrow `packet.payload` once the packet type is known. A raw `Buffer` is also
 * allowed for empty or not-yet-parsed payloads.
 */
export type BroadlinkPayload =
  | BroadlinkPayloadHelloResponse
  | BroadlinkPayloadAuthCommand
  | BroadlinkPayloadAuthResponse
  | BroadlinkPayloadCommandRequest
  | BroadlinkPayloadCommandResponse
  | Buffer;

/**
 * Interface representing the plaintext payload of an Auth Command (0x65) packet.
 *
 * The payload is AES-128-CBC encrypted on the wire (default key/IV) and preceded by the
 * Command Extended Header. It identifies the client to the device; the device answers
 * with an Auth Response (0x3e9) containing the assigned device ID and session key.
 *
 * @interface BroadlinkPayloadAuthCommand
 */
export interface BroadlinkPayloadAuthCommand {
  payloadType:      PayloadType.Command.Auth;  // discriminant
  deviceIdentifier: string;  // 16-byte client identifier (e.g. IMEI-like), zero-padded ASCII
  clientName:       string;  // 32-byte NULL-terminated ASCII client name
  authBlob:         Buffer;  // 16-byte auth blob
  metadata:         string;  // JSON string with cloud server info (may be empty)
}

/**
 * Interface representing the plaintext payload of an Auth Response (0x3e9) packet.
 *
 * Contains the device ID assigned to this client (to be used in the extended header of all
 * subsequent packets) and the per-session AES key that replaces the default key.
 *
 * @interface BroadlinkPayloadAuthResponse
 */
export interface BroadlinkPayloadAuthResponse {
  payloadType: PayloadType.Response.Auth;  // discriminant
  deviceId:    number;  // 4-byte assigned device ID
  sessionKey:  Buffer;  // 16-byte AES session key
}

/**
 * Interface representing the plaintext payload of a Command Request (0x6a) packet
 * in the "new" format (RM3*, RM4 and RM5): inner length + command + data.
 *
 * @interface BroadlinkPayloadCommandRequest
 */
export interface BroadlinkPayloadCommandRequest {
  payloadType: PayloadType.Command.Command;  // discriminant
  command:     number;  // LE uint32 operation, see PayloadType.RMCommand
  data:        Buffer;  // command-specific data
}

/**
 * Interface representing the plaintext payload of a Command Response (0x3ee) packet
 * in the "new" format (RM3*, RM4 and RM5). Same layout as the request.
 *
 * @interface BroadlinkPayloadCommandResponse
 */
export interface BroadlinkPayloadCommandResponse {
  payloadType: PayloadType.Response.Command;  // discriminant
  command:     number;  // LE uint32, echoes the operation
  data:        Buffer;  // command-specific data (e.g. captured IR code)
}



/** Device lock status as represented in HelloResponse payloads. */
export const enum DeviceLockStatus {
  Unlocked = 0x00,
  Locked = 0x01,
}

/**
 * Interface representing the payload of a Hello Response packet from a BroadLink device.
 *
 * The Hello Response packet is sent by a BroadLink device in response to a Hello Request packet.
 * It contains information about the device, such as its ID, type, IP address, MAC address, name, and lock status.
 *
 * @interface BroadlinkPayloadHelloResponse
 */
export interface BroadlinkPayloadHelloResponse {
  payloadType:      PayloadType.Response.Hello;  // discriminant
  deviceId:         number;  // 4-byte Device ID (based on Epoch Unix Timestamp at production time???)
  deviceType:       number;  // 2-byte Device Type
  deviceIP:         string;  // 4-byte Device IP address
  deviceMacAddress: string;  // 6-byte MAC address
  deviceName:       string;  // UTF-8 string, null-terminated
  deviceLocked:     DeviceLockStatus;
}


/**
 * Namespace containing constants for BroadLink packet payload types.
 *
 * The payload type is a field in the BroadLink packet header that indicates the type of data contained in the payload.
 * It can be one of three categories: Command, Response, or Signal, each with its own set of specific types.
 * 
 * The payload type is located at packet[0x26] in the BroadLink packet header.
 *
 * @namespace PayloadType
 */
export namespace PayloadType {

  export const enum Command {
    Ping      = 0x01,  // keepalive/heartbeat, basic header only, no response
    Hello     = 0x06,
    Discover  = 0x1a,
    Join      = 0x14,  // This seems not to be common - join request from device to client, or join response from client to device
    Auth      = 0x65,
    Command   = 0x6a,  // RM command (IR/RF)
  }

  export const enum Response {
    Hello     = 0x07,
    Discover  = 0x1b,
    Join      = 0x15,
    JoinError = 0x398, // sent when a Join Request is received but the device is already connected to WiFi
    Auth      = 0x3e9,
    Command   = 0x3ee,
  }

  export const enum RMCommand {
    SendData = 0x02,
    Learn    = 0x03,
    Check    = 0x04,
  }
}


export const enum ResponseStatus {
  OK = 0x0000,
}

/**
 * Error codes as returned in the Error Code field (0x22-0x23) of the basic header.
 * The field is a *signed* LE int16; 0 means success.
 */
export const enum ErrorCode {
  Success              = 0,
  AuthenticationFailed = -1,
  LoggedOut            = -2,
  DeviceOffline        = -3,
  CommandNotSupported  = -4,
  StorageFull          = -5,
  StructureAbnormal    = -6,
  ControlKeyExpired    = -7,
  SendError            = -8,
  WriteError           = -9,
  ReadError            = -10,
  SsidNotFound         = -11,
}


export const enum Signal {
    Infrared = 0x26,
    RF433 = 0xb2,
    RF315 = 0xd7,
}

// https://github.com/csabavirag/broadlink-dissector/blob/master/broadlink.lua
// https://raw.githubusercontent.com/bblacey/Vera-Plugin-BroadLink-Mk2/60b0de553c3e68284811f16437a011ed7c39f559/Luup_device/L_BroadLink_Mk2_1.lua