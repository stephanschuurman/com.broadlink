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
import { BroadlinkPacketBase } from './packet-base';

/**
 * Builds the UDP broadcast packet used to authenticate Broadlink devices
 */
export class AuthCommandPacket extends BroadlinkPacketBase {

  readonly header: BroadlinkHeader;
  readonly payload: BroadlinkPayloadAuthCommand;

  /**
   * @param localIp   Local IPv4 address string, e.g. "192.168.1.10", or null/undefined to use broadcast address "255.255.255.255"
   * @param srcPort   UDP source port to advertise in the packet, or null/undefined to use a random port in the dynamic/private range (49152-65535)
   * @param now       Optional Date to use instead of the current time (useful for tests)
   */
  constructor(localIp: string, srcPort: number, now: Date = new Date()) {
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
      deviceId: 0,
    };
  }
}
