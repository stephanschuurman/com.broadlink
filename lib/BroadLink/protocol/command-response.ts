/**
 * Broadlink command response packet (new format: RM3*, RM4 and RM5).
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

import { PayloadType, BroadlinkHeader, BroadlinkPayloadCommandResponse } from './types';
import { BroadlinkEncryptedPacketBase } from './encrypted-packet-base';

/**
 * Parses (and builds) a Command Response (0x3ee) packet in the "new" format used by
 * RM3*, RM4 and RM5. Same inner layout as the request:
 *
 *   0x00-0x01  Inner length — LE uint16, length of command + data (i.e. data length + 4)
 *   0x02-0x05  Command — LE uint32, echoes the operation
 *   0x06-…     Data — command-specific data (e.g. the captured IR code after a Check)
 *
 * Note the header's error code (0x22-0x23): non-zero means the command failed and the
 * payload should not be trusted.
 */
export class CommandResponsePacket extends BroadlinkEncryptedPacketBase {
  static readonly INNER_HEADER_SIZE = 0x06;

  readonly header: BroadlinkHeader;
  readonly payload: BroadlinkPayloadCommandResponse;

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
      payloadType: PayloadType.Response.Command,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = {
      payloadType: PayloadType.Response.Command,
      command:     0,
      data:        Buffer.alloc(0),
    };
  }

  override encodePlainPayload(): Buffer {
    const data = this.payload.data;
    const buf = Buffer.alloc(CommandResponsePacket.INNER_HEADER_SIZE + data.length);
    buf.writeUInt16LE(data.length + 4, 0x00);
    buf.writeUInt32LE(this.payload.command, 0x02);
    data.copy(buf, 0x06);
    return buf;
  }

  override decodePlainPayload(plainPayload: Buffer): void {
    const innerLength = plainPayload.readUInt16LE(0x00);
    this.payload.command = plainPayload.readUInt32LE(0x02);
    this.payload.data = Buffer.from(plainPayload.subarray(0x06, 0x02 + innerLength));
  }

  /** Whether the device reported success in the header's error code field. */
  get isSuccess(): boolean {
    return this.header.errorCode === 0;
  }

  /**
   * Parse a raw UDP response buffer.
   * @param buf         The full packet as received on the wire
   * @param sessionKey  The AES session key obtained during Auth (defaults to the well-known default key)
   */
  static from(buf: Buffer, sessionKey?: Buffer): CommandResponsePacket {
    const p = new CommandResponsePacket();
    if (sessionKey) p.key = sessionKey;
    p.decodePacket(buf);
    return p;
  }
}
