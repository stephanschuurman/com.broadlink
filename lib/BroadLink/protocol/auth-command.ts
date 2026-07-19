/**
 * Broadlink network discovery packet.
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

import { PayloadType, BroadlinkHeader, BroadlinkPayloadAuthCommand } from './types';
import { BroadlinkEncryptedPacketBase } from './encrypted-packet-base';

/**
 * Builds the Auth Request (0x65) packet used to authenticate with a Broadlink device.
 *
 * The plaintext payload layout (offsets relative to payload start, encrypted from 0x38
 * on the wire with the default AES-128-CBC key/IV):
 *
 *   0x00-0x03  Reserved (0x00000000)
 *   0x04-0x13  Device Identifier — 16-byte client identifier (e.g. IMEI), zero-padded
 *   0x14-0x1d  Reserved
 *   0x1e       Flag 0x01
 *   0x1f-0x2c  Reserved
 *   0x2d       Flag 0x01
 *   0x2e-0x2f  Reserved
 *   0x30-0x4f  Client Name — NULL-terminated ASCII string, zero-padded to 32 bytes
 *   0x50-0x53  Reserved
 *   0x54-0x63  Auth Blob — 16 bytes
 *   0x64-…     Metadata JSON string (variable length, may be empty)
 */
export class AuthCommandPacket extends BroadlinkEncryptedPacketBase {
  static readonly FIXED_PAYLOAD_SIZE = 0x64;

  readonly header: BroadlinkHeader;
  readonly payload: BroadlinkPayloadAuthCommand;

  /**
   * @param localIp   Local IPv4 address string, e.g. "192.168.1.10", or null/undefined to use broadcast address "255.255.255.255"
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
      payloadType: PayloadType.Command.Auth,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = {
      payloadType:      PayloadType.Command.Auth,
      deviceIdentifier: '',
      clientName:       '',
      authBlob:         Buffer.alloc(0x10),
      metadata:         '',
    };
  }

  override encodePlainPayload(): Buffer {
    const metadata = Buffer.from(this.payload.metadata ?? '', 'utf-8');
    const buf = Buffer.alloc(AuthCommandPacket.FIXED_PAYLOAD_SIZE + metadata.length);

    // 0x04-0x13: device identifier (max 16 bytes, zero-padded)
    buf.write(this.payload.deviceIdentifier, 0x04, 0x10, 'ascii');

    // 0x1e / 0x2d: flags
    buf[0x1e] = 0x01;
    buf[0x2d] = 0x01;

    // 0x30-0x4f: client name (max 31 bytes + NULL terminator)
    buf.write(this.payload.clientName, 0x30, 0x1f, 'ascii');

    // 0x54-0x63: auth blob (16 bytes)
    this.payload.authBlob.copy(buf, 0x54, 0, 0x10);

    // 0x64-…: metadata JSON
    metadata.copy(buf, 0x64);

    return buf;
  }

  override decodePlainPayload(plainPayload: Buffer): void {
    this.payload.deviceIdentifier = plainPayload.toString('ascii', 0x04, 0x14).replace(/\0.*$/, '');
    this.payload.clientName = plainPayload.toString('ascii', 0x30, 0x50).replace(/\0.*$/, '');
    this.payload.authBlob = Buffer.from(plainPayload.subarray(0x54, 0x64));
    this.payload.metadata = plainPayload.toString('utf-8', 0x64).replace(/\0+$/, '');
  }
}
