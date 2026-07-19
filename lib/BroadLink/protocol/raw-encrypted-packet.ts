/**
 * Broadlink encrypted packet with a raw (opaque) plaintext payload.
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

import { PayloadType, BroadlinkHeader } from './types';
import { BroadlinkEncryptedPacketBase } from './encrypted-packet-base';

/**
 * Encrypted packet whose plaintext payload is an opaque Buffer.
 *
 * Useful as a generic transport for the classic command format (RM2/RM3/SP1/SP2:
 * subcommand byte at 0x00) and other payloads that are not (yet) modelled as a
 * dedicated packet class. The extended header, payload checksum and AES layer
 * are handled by BroadlinkEncryptedPacketBase.
 */
export class RawEncryptedPacket extends BroadlinkEncryptedPacketBase {
  readonly header: BroadlinkHeader;
  payload: Buffer;

  /**
   * @param payloadType Payload type for the basic header (e.g. 0x6a Command, 0x65 Auth)
   * @param now         Optional Date to use instead of the current time (useful for tests)
   */
  constructor(payloadType: number = PayloadType.Command.Command, now: Date = new Date()) {
    super();
    this.header = {
      magicHeader: Buffer.from([0x5a, 0xa5, 0xaa, 0x55, 0x5a, 0xa5, 0xaa, 0x55]),
      timestamp:   now,
      srcIp:       '0.0.0.0',
      srcPort:     0,
      checksum:    0,
      errorCode:   0,
      deviceType:  0,
      payloadType: payloadType as any,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = Buffer.alloc(0);
  }

  override encodePlainPayload(): Buffer {
    return this.payload;
  }

  override decodePlainPayload(plainPayload: Buffer): void {
    this.payload = Buffer.from(plainPayload);
  }

  /**
   * Parse a raw UDP buffer (basic header + extended header + encrypted payload).
   * @param buf The full packet as received on the wire
   * @param key The AES key to decrypt with (defaults to the well-known default key)
   */
  static from(buf: Buffer, key?: Buffer): RawEncryptedPacket {
    const p = new RawEncryptedPacket();
    if (key) p.key = key;
    p.decodePacket(buf);
    return p;
  }
}
