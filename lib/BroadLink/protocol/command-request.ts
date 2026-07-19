/**
 * Broadlink command request packet (new format: RM3*, RM4 and RM5).
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

import { PayloadType, BroadlinkHeader, BroadlinkPayloadCommandRequest } from './types';
import { BroadlinkEncryptedPacketBase } from './encrypted-packet-base';

/**
 * Builds a Command Request (0x6a) packet in the "new" format used by RM3*, RM4 and RM5.
 *
 * The plaintext payload layout (offsets relative to payload start, encrypted from 0x38
 * on the wire with the *session* key obtained during Auth):
 *
 *   0x00-0x01  Inner length — LE uint16, length of command + data (i.e. data length + 4)
 *   0x02-0x05  Command — LE uint32, identifies the operation (see PayloadType.RMCommand)
 *   0x06-…     Data — command-specific data
 *
 * Note: classic devices (RM2/RM3/SP1/SP2) use a different layout (subcommand byte at
 * 0x00) and are not covered by this class.
 */
export class CommandRequestPacket extends BroadlinkEncryptedPacketBase {
  static readonly INNER_HEADER_SIZE = 0x06;

  readonly header: BroadlinkHeader;
  readonly payload: BroadlinkPayloadCommandRequest;

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
      payloadType: PayloadType.Command.Command,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = {
      payloadType: PayloadType.Command.Command,
      command:     0,
      data:        Buffer.alloc(0),
    };
  }

  override encodePlainPayload(): Buffer {
    const data = this.payload.data;
    const buf = Buffer.alloc(CommandRequestPacket.INNER_HEADER_SIZE + data.length);
    buf.writeUInt16LE(data.length + 4, 0x00);       // inner length: command (4) + data
    buf.writeUInt32LE(this.payload.command, 0x02);
    data.copy(buf, 0x06);
    return buf;
  }

  override decodePlainPayload(plainPayload: Buffer): void {
    const innerLength = plainPayload.readUInt16LE(0x00);
    this.payload.command = plainPayload.readUInt32LE(0x02);
    // Inner length counts command + data, both starting at 0x02 (this strips the AES zero padding).
    this.payload.data = Buffer.from(plainPayload.subarray(0x06, 0x02 + innerLength));
  }

  // ── Convenience factories for the RM flows ──

  /** Enter IR/RF learning mode (RMCommand.Learn, no data). */
  static enterLearning(localIp?: string, srcPort?: number): CommandRequestPacket {
    const p = new CommandRequestPacket(localIp, srcPort);
    p.payload.command = PayloadType.RMCommand.Learn;
    return p;
  }

  /** Read back the code captured in learning mode (RMCommand.Check, no data). */
  static checkData(localIp?: string, srcPort?: number): CommandRequestPacket {
    const p = new CommandRequestPacket(localIp, srcPort);
    p.payload.command = PayloadType.RMCommand.Check;
    return p;
  }

  /**
   * Send an IR/RF code (RMCommand.SendData).
   * @param data The raw Broadlink code blob: signal type, repeat count, length and pulse data.
   */
  static sendData(data: Buffer, localIp?: string, srcPort?: number): CommandRequestPacket {
    const p = new CommandRequestPacket(localIp, srcPort);
    p.payload.command = PayloadType.RMCommand.SendData;
    p.payload.data = data;
    return p;
  }
}
