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

import { PayloadType, BroadlinkHeader, BroadlinkPayloadHelloResponse, DeviceLockStatus } from './types';
import { BroadlinkPacketBase } from './packet-base';

/**
 * Builds a UDP broadcast packet used to respond to discovery packets from Broadlink devices on the local network.
 */
export class HelloResponsePacket extends BroadlinkPacketBase {
  
  readonly header:  BroadlinkHeader & { payloadType: PayloadType.Response.Hello };
  readonly payload: BroadlinkPayloadHelloResponse;

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
      payloadType: PayloadType.Response.Hello,
      packetCount: 0,
      macAddress:  '00:00:00:00:00:00',
    };
    this.payload = {
      deviceId: 0x0000000000,
      deviceType: 0x0000,
      deviceIP: '0.0.0.0',
      deviceMacAddress: '00:00:00:00:00:00',
      deviceName: '',
      deviceLocked: DeviceLockStatus.Unlocked,
    };
  }

  /**
   * Builds the payload buffer for the Hello Response packet based on the properties of this.payload (the total payload length is 0x50 bytes). 
   * The payload contains information about the responding device, such as its ID, type, IP address, MAC address, name, and lock status.
   * The payload structure is as follows:
   * - 0x30-0x33: deviceId (4 bytes, LE uint32) perhaps this is based on the Epoch Unix Timestamp at production time...
   * - 0x34-0x35: deviceType (2 bytes, LE uint16)
   * - 0x36-0x39: deviceIP (4 bytes, each octet as a byte)
   * - 0x3a-0x3f: deviceMacAddress (6 bytes, each octet as a byte)
   * - 0x40-0x7d: deviceName (60 bytes, UTF-8 string, null-terminated)
   * - 0x7e: deviceLocked (1 byte)
   * - 0x7f: null terminator (1 byte)
   * @returns Buffer containing the payload for the Hello Response packet
   */
  override encodePayload(): Buffer {
    const payload = Buffer.alloc(0x50);

    // 0x30-0x33 = deviceId
    payload.writeUInt32LE(this.payload.deviceId, 0x30 - 0x30);

    // 0x34-0x35 = deviceType
    payload.writeUInt16LE(this.payload.deviceType, 0x34 - 0x30);

    // 0x36-0x39 = deviceIP (stored reversed: last octet first)
    this.payload.deviceIP.trim().split('.').reverse().forEach((octet, i) => {
      payload[6 + i] = parseInt(octet, 10);
    });

    // 0x3a-0x3f = deviceMacAddress
    this.payload.deviceMacAddress.split(':').forEach((octet, i) => {
      payload[0x3a - 0x30 + i] = parseInt(octet, 16);
    });

    // 0x40-0x7d = deviceName (UTF-8 string, null-terminated)
    payload.write(this.payload.deviceName, 0x40 - 0x30, 'utf-8');

    // 0x7e: Unknown byte, in observed packets 0x02 or 0x03
    payload[0x7E - 0x30] = 0x00;

    // 0x7f: deviceLocked
    payload[0x7F - 0x30] = this.payload.deviceLocked;

    return payload; 
  }

  override decodePayload(payloadBuffer: Buffer): void {
    this.payload.deviceId = payloadBuffer.readUInt32LE(0x30 - 0x30);
    this.payload.deviceType = payloadBuffer.readUInt16LE(0x34 - 0x30);
    this.payload.deviceIP = [...payloadBuffer.subarray(6, 10)].reverse().join('.');
    this.payload.deviceMacAddress = [...payloadBuffer.subarray(0xA, 0x10)].map(b => b.toString(16).padStart(2, '0')).join(':');
    this.payload.deviceName = payloadBuffer.toString('utf-8', 0x10, 0x10 + 60).replace(/\0.*$/, ''); // trim at null terminator
    this.payload.deviceLocked = payloadBuffer[0x7F - 0x30] as DeviceLockStatus;
  }

  get deviceMacAddress(): string {
    return this.payload.deviceMacAddress;
  }

  get deviceMacAddressRaw(): Buffer {
    return Buffer.from(this.payload.deviceMacAddress.split(':').map(o => parseInt(o, 16)));
  }

  get deviceIsLocked(): boolean {
    return (this.payload.deviceLocked == DeviceLockStatus.Locked);
  }

  static from(buf: Buffer): HelloResponsePacket {
    const p = new HelloResponsePacket();
    p.decodePacket(buf);
    return p;
  }
}
