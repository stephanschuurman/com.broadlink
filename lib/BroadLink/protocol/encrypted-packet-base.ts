/**
 * Abstract base class for encrypted Broadlink protocol packets
 * (all non-hello packets: Auth, Command, …).
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

import { createCipheriv, createDecipheriv } from 'crypto';
import { BroadlinkPacketBase } from './packet-base';

/**
 * Base class for all Broadlink packets that carry the Command Extended Header
 * and an AES-128-CBC encrypted payload.
 *
 * The wire format after the 0x30-byte basic header is:
 *
 *   Offset (abs) Contents
 *   0x30-0x33    Device ID, LE uint32 (0x00000000 before authentication)
 *   0x34-0x35    Checksum of the *unencrypted* payload, LE uint16
 *   0x36-0x37    Padding (zeros)
 *   0x38+        AES-128-CBC encrypted payload (zero-padded to a 16-byte multiple)
 *
 * All devices share a well-known default key and IV, used during provisioning
 * and the initial Auth handshake. After a successful Auth the device issues a
 * per-session key (see AuthResponsePacket) that replaces the default key for
 * all subsequent Command packets; the IV stays the same.
 */
export abstract class BroadlinkEncryptedPacketBase extends BroadlinkPacketBase {
  static readonly EXTENDED_HEADER_SIZE = 0x08;
  static readonly AES_BLOCK_SIZE       = 0x10;
  static readonly DEFAULT_KEY = Buffer.from('097628343fe99e23765c1513accf8b02', 'hex');
  static readonly DEFAULT_IV  = Buffer.from('562e17996d093d28ddb3ba695a2e6f58', 'hex');

  /** Device ID from the extended header; 0 before authentication. */
  deviceId = 0;

  /** AES key: the default key until Auth supplies a session key. */
  key: Buffer = BroadlinkEncryptedPacketBase.DEFAULT_KEY;

  /** AES IV: identical for all devices and sessions. */
  iv: Buffer = BroadlinkEncryptedPacketBase.DEFAULT_IV;

  /** Whether the payload checksum in the extended header matched on decode. */
  payloadChecksumValid?: boolean;

  /** Serialize the plaintext (unencrypted) payload of the concrete packet type. */
  abstract encodePlainPayload(): Buffer;

  /** Parse the decrypted plaintext payload of the concrete packet type. */
  abstract decodePlainPayload(plainPayload: Buffer): void;

  /**
   * Builds the extended header + encrypted payload:
   * encodePlainPayload() → zero-pad to 16 bytes → AES-encrypt → prepend extended header.
   */
  override encodePayload(): Buffer {
    const plain = this.encodePlainPayload();

    // Zero-pad to a multiple of the AES block size (zero bytes do not affect the checksum).
    const blockSize = BroadlinkEncryptedPacketBase.AES_BLOCK_SIZE;
    const paddedLength = Math.ceil(plain.length / blockSize) * blockSize;
    const padded = paddedLength === plain.length
      ? plain
      : Buffer.concat([plain, Buffer.alloc(paddedLength - plain.length)]);

    const cipher = createCipheriv('aes-128-cbc', this.key, this.iv);
    cipher.setAutoPadding(false); // Broadlink uses plain zero padding, not PKCS#7
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    const extendedHeader = Buffer.alloc(BroadlinkEncryptedPacketBase.EXTENDED_HEADER_SIZE);
    extendedHeader.writeUInt32LE(this.deviceId, 0x00);
    extendedHeader.writeUInt16LE(BroadlinkPacketBase.calculateChecksum(plain), 0x04);
    // 0x06-0x07: padding, already zero

    return Buffer.concat([extendedHeader, encrypted]);
  }

  /**
   * Parses the extended header, decrypts the payload, validates the payload
   * checksum and hands the plaintext to decodePlainPayload().
   */
  override decodePayload(payloadBuffer: Buffer): void {
    this.deviceId = payloadBuffer.readUInt32LE(0x00);
    const expectedChecksum = payloadBuffer.readUInt16LE(0x04);

    const encrypted = payloadBuffer.subarray(BroadlinkEncryptedPacketBase.EXTENDED_HEADER_SIZE);
    const decipher = createDecipheriv('aes-128-cbc', this.key, this.iv);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    // Zero padding does not contribute to the checksum, so validating over the
    // padded plaintext is equivalent to validating over the original payload.
    this.payloadChecksumValid =
      (BroadlinkPacketBase.calculateChecksum(plain) === expectedChecksum);

    this.decodePlainPayload(plain);
  }
}
