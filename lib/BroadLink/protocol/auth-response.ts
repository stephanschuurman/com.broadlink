/**
 * Broadlink authentication response packet.
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

import { PayloadType, BroadlinkHeader, BroadlinkPayloadAuthResponse } from './types';
import { BroadlinkEncryptedPacketBase } from './encrypted-packet-base';

/**
 * Parses (and builds) the Auth Response (0x3e9) packet sent by a Broadlink device
 * in reply to an Auth Request (0x65).
 *
 * The plaintext payload layout (offsets relative to payload start, encrypted from 0x38
 * on the wire with the default AES-128-CBC key/IV):
 *
 *   0x00-0x03  Device ID — assigned by the device; use in the extended header of all subsequent packets
 *   0x04-0x13  Session Key — 16-byte AES key replacing the default key for subsequent Command packets
 *   0x14-0x1f  Tail padding (zeros)
 */
export class AuthResponsePacket extends BroadlinkEncryptedPacketBase {
  static readonly PLAIN_PAYLOAD_SIZE = 0x20;

  readonly header: BroadlinkHeader;
  readonly payload: BroadlinkPayloadAuthResponse;

  /**
   * @param localIp   Local IPv4 address string, or null/undefined to use broadcast address "255.255.255.255"
   * @param srcPort   UDP source port to advertise in the packet, or null/undefined to use a random port in the dynamic/private range (49152-65535)
   * @param now       Optional Date to use instead of the current time (useful for tests)
   */
  constructor(localIp: string = null, srcPort: number = null, now: Date = new Date()) {
    super();
    this.header = {
      magicHeader: Buffer.from([0x5a, 0xa5, 0xaa, 0x55, 0x5a, 0xa5, 0xaa, 0x55]),
      timestamp:     now,
      srcIp:       localIp  || '255.255.255.255',
      srcPort:     srcPort  || (49152 + (Math.random() * 16383 | 0)),
      checksum:    0,
      errorCode:   0,
      deviceType:  0,
      payloadType: PayloadType.Response.Auth,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = {
      payloadType: PayloadType.Response.Auth,
      deviceId:    0,
      sessionKey:  Buffer.alloc(0x10),
    };
  }

  override encodePlainPayload(): Buffer {
    const buf = Buffer.alloc(AuthResponsePacket.PLAIN_PAYLOAD_SIZE);
    buf.writeUInt32LE(this.payload.deviceId, 0x00);
    this.payload.sessionKey.copy(buf, 0x04, 0, 0x10);
    // 0x14-0x1f: tail padding, already zero
    return buf;
  }

  override decodePlainPayload(plainPayload: Buffer): void {
    this.payload.deviceId = plainPayload.readUInt32LE(0x00);
    this.payload.sessionKey = Buffer.from(plainPayload.subarray(0x04, 0x14));
  }

  /** The AES session key issued by the device for all subsequent Command packets. */
  get sessionKey(): Buffer {
    return this.payload.sessionKey;
  }

  static from(buf: Buffer): AuthResponsePacket {
    const p = new AuthResponsePacket();
    p.decodePacket(buf);
    return p;
  }
}
