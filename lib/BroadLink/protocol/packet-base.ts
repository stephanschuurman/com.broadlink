/**
 * Abstract base class for all Broadlink protocol packets.
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

import { BroadlinkHeader, BroadlinkPayload, BroadlinkPacket } from './types';

/**
 * Base class for all Broadlink packets.
 *
 * The wire format is always:
 *
 *   Offset    Contents
 *   0x00-0x07 Magic header (8 bytes)
 *   0x08-0x0b GMT offset in whole hours, signed LE int32
 *   0x0c-0x0d Year, LE uint16
 *   0x0e      Seconds
 *   0x0f      Minutes
 *   0x10      Hours
 *   0x11      Day of week (Monday = 1 … Sunday = 7)
 *   0x12      Day of month
 *   0x13      Month (1-based)
 *   0x14-0x17 Padding
 *   0x18-0x1b Local IP address (one octet per byte)
 *   0x1c-0x1d Source port, LE uint16
 *   0x1e-0x1f Padding
 *   0x20-0x21 Checksum, LE uint16
 *   0x22-0x23 Error code, LE uint16
 *   0x24-0x25 Device type, LE uint16
 *   0x26-0x27 Payload type, LE uint16
 *   0x28-0x29 Packet count, LE uint16
 *   0x2a-0x2f MAC address (6 bytes)
 *   0x30+     Payload (optional, variable length)
 */
export abstract class BroadlinkPacketBase implements BroadlinkPacket {
  static readonly HEADER_SIZE   = 0x30;
  static readonly INIT_CHECKSUM = 0xbeaf;

  abstract readonly header:  BroadlinkHeader;
  abstract readonly payload: BroadlinkPayload;

  encodePayload(): Buffer {
    return Buffer.alloc(0);
  }

  decodePayload(payloadBuffer: Buffer): void {
    // Default implementation does nothing; override in subclasses if the packet has a payload.
  }

  encodePacket(): Buffer {
    const payloadBuffer = this.encodePayload();
    const buf = Buffer.alloc(BroadlinkPacketBase.HEADER_SIZE + payloadBuffer.length);

    // ── 0x00-0x07: magic header ──
    buf.set(this.header.magicHeader, 0x00);

    // ── 0x08-0x0b: GMT offset in whole hours, without DST, as signed LE int32 ──
    // getTimezoneOffset() returns (UTC − local) in minutes, so negate and divide.
    const jan     = new Date(this.header.timestamp.getFullYear(), 0, 1);
    const tzHours = (jan.getTimezoneOffset() / -60) | 0;
    buf.writeUInt32LE(tzHours, 0x08);

    // ── 0x0c-0x0d: year (LE uint16) ──
    buf.writeUInt16LE(this.header.timestamp.getFullYear(), 0x0c);

    // ── 0x0e: seconds past the minute ──
    buf[0x0e] = this.header.timestamp.getSeconds();

    // ── 0x0f: minutes past the hour ──
    buf[0x0f] = this.header.timestamp.getMinutes();

    // ── 0x10: hours past midnight ──
    buf[0x10] = this.header.timestamp.getHours();

    // ── 0x11: ISO day of week (Monday = 1, Sunday = 7) ──
    buf[0x11] = (this.header.timestamp.getDay() + 6) % 7 + 1;

    // ── 0x12: day of month ──
    buf[0x12] = this.header.timestamp.getDate();

    // ── 0x13: month (1-based) ──
    buf[0x13] = this.header.timestamp.getMonth() + 1;

    // ── 0x14-0x17: padding of 4 bytes ──
    buf.writeUInt32LE(0, 0x14);

    // ── 0x18-0x1b: local IP address ──
    const octets = this.header.srcIp.split('.').map(Number);
    buf[0x18] = octets[0];
    buf[0x19] = octets[1];
    buf[0x1a] = octets[2];
    buf[0x1b] = octets[3];

    // ── 0x1c-0x1d: source port (LE uint16) ──
    buf.writeUInt16LE(this.header.srcPort, 0x1c);

    // ── 0x1e-0x1f: padding of 2 bytes ──
    buf.writeUInt16LE(0, 0x1e);

    // ── 0x20-0x21: see below, calculated after payload is in place ──

    // ── 0x22-0x23: error code (LE uint16) ──
    buf.writeUInt16LE(this.header.errorCode, 0x22);

    // ── 0x24-0x25: device type (LE uint16) ──
    buf.writeUInt16LE(this.header.deviceType, 0x24);

    // ── 0x26-0x27: payload type (LE uint16) ──
    buf.writeUInt16LE(this.header.payloadType, 0x26);

    // ── 0x28-0x29: packet count (LE uint16) ──
    buf.writeUInt16LE(this.header.packetCount, 0x28);

    // ── 0x2a-0x2f: MAC address (6 bytes) ──
    const macOctets = this.header.macAddress.split(':').map(s => parseInt(s, 16));
    buf[0x2a] = macOctets[0];
    buf[0x2b] = macOctets[1];
    buf[0x2c] = macOctets[2];
    buf[0x2d] = macOctets[3];
    buf[0x2e] = macOctets[4];
    buf[0x2f] = macOctets[5];

    // ── 0x30+: payload ──
    buf.set(payloadBuffer, 0x30);

    // ── 0x20-0x21: checksum over the whole packet (LE uint16) ──
    // Calculated last so the payload is already in the buffer.
    const calculatedChecksum = BroadlinkPacketBase.calculateChecksum(buf);
    this.header.checksumValid = (buf.writeUInt16LE(calculatedChecksum, 0x20) === this.header.checksum);
    buf.writeUInt16LE(calculatedChecksum, 0x20);

    return buf;
  }

  decodePacket(buf: Buffer): void {
    this.header.magicHeader = buf.subarray(0x00, 0x08);
    this.header.timestamp = new Date(
      buf.readUInt16LE(0x0c), // year
      buf[0x13] - 1,          // month (0-based)
      buf[0x12],              // day
      buf[0x10],              // hours
      buf[0x0f],              // minutes
      buf[0x0e],              // seconds
    );
    this.header.srcIp = `${buf[0x18]}.${buf[0x19]}.${buf[0x1a]}.${buf[0x1b]}`;
    this.header.srcPort = buf.readUInt16LE(0x1c);
    this.header.checksum = buf.readUInt16LE(0x20);
    this.header.errorCode = buf.readUInt16LE(0x22);
    this.header.deviceType = buf.readUInt16LE(0x24);
    this.header.payloadType = buf.readUInt16LE(0x26);
    this.header.packetCount = buf.readUInt16LE(0x28);
    this.header.macAddress = [0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f]
                             .map(o => buf[o].toString(16).padStart(2, '0'))
                             .join(':');
    this.decodePayload(buf.subarray(0x30, buf.length));
    this.header.checksumValid = (buf.readUInt16LE(0x20) === BroadlinkPacketBase.calculateChecksum(buf));
  }

  // ── Convenience getters and static methods ------
  get packet(): BroadlinkPacket {
    return {
      header: this.header,
      payload: this.payload,
    };
  }

  get packetRaw(): Buffer {
    return this.encodePacket();
  }

  get macAddress() {
    return this.header.macAddress;
  }

  get macAddressRaw(): Buffer {
    const macOctets = this.header.macAddress.split(':').map(s => parseInt(s, 16));
    return Buffer.from(macOctets);
  }

  // ── Static utility methods ──

  /* Calculate the checksum for a given buffer. The checksum is calculated as:
  (0xbeaf + sum of all bytes in the buffer) & 0xffff
  */
  static calculateChecksum(buf: Buffer): number {
    let checksum = BroadlinkPacketBase.INIT_CHECKSUM;
    for (let i = 0; i < buf.length; i++) {
      checksum += buf[i];
    }
    return checksum & 0xffff;
  }

  /** Returns the packet bytes as a Uint8Array (zero-copy). */
  toUint8Array(): Uint8Array {
    const buf = this.encodePacket();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Returns the packet bytes as a Node.js Buffer. Useful for passing directly to dgram.Socket.send(). */
  toBuffer(): Buffer {
    return this.encodePacket();
  }

  /**
   * Parse a raw UDP response buffer into a BroadlinkPacket.
   * The first 0x30 bytes are the header; anything beyond is the payload.
   */
  static parse(buf: Buffer): BroadlinkPacket {
    return {
      header:  BroadlinkPacketBase.parseHeader(buf),
      payload: buf.length > BroadlinkPacketBase.HEADER_SIZE
                 ? buf.subarray(BroadlinkPacketBase.HEADER_SIZE)
                 : Buffer.alloc(0),
    };
  }

  static parseHeader(buf: Buffer): BroadlinkHeader {
    const year    = buf.readUInt16LE(0x0c);
    const month   = buf[0x13] - 1; // 0-based for Date
    const day     = buf[0x12];
    const hours   = buf[0x10];
    const minutes = buf[0x0f];
    const seconds = buf[0x0e];

    return {
      magicHeader: buf.subarray(0x00, 0x08),
      timestamp:     new Date(year, month, day, hours, minutes, seconds),
      srcIp:       `${buf[0x18]}.${buf[0x19]}.${buf[0x1a]}.${buf[0x1b]}`,
      srcPort:     buf.readUInt16LE(0x1c),
      checksum:    buf.readUInt16LE(0x20),
      errorCode:   buf.readUInt16LE(0x22),
      deviceType:  buf.readUInt16LE(0x24),
      payloadType: buf.readUInt16LE(0x26),
      packetCount: buf.readUInt16LE(0x28),
      macAddress:  [0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f]
                     .map(o => buf[o].toString(16).padStart(2, '0'))
                     .join(':'),
    };
  }

  /**
   * Compares two byte arrays and returns a formatted string showing each byte side by side.
   * Bytes that differ are marked with '<<'.
   */
  static diff(a: Uint8Array, b: Uint8Array, labelA = 'a', labelB = 'b'): string {
    const len = Math.max(a.length, b.length);
    const lines: string[] = [
      `offset  ${labelA.padEnd(4)}  ${labelB.padEnd(4)}`,
      `------  ----  ----`,
    ];
    for (let i = 0; i < len; i++) {
      const byteA = i < a.length ? a[i].toString(16).padStart(2, '0') : '--';
      const byteB = i < b.length ? b[i].toString(16).padStart(2, '0') : '--';
      const mark  = byteA !== byteB ? '  <<' : '';
      lines.push(`0x${i.toString(16).padStart(2, '0')}    ${byteA}    ${byteB}${mark}`);
    }
    return lines.join('\n');
  }
}

// https://github.com/mjg59/python-broadlink/blob/730853e5faf2cf979596662faf9def2b1f8fee6d/protocol.md
// https://blog.ipsumdomus.com/broadlink-smart-home-devices-complete-protocol-hack-bc0b4b397af1
// https://github.com/tomwpublic/hubitat_broadlink
