/**
 * Broadlink IR/RF packet builder.
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
 * Represents a Broadlink IR/RF packet.
 *
 * Wire format:
 *   [type(1)] [repeatFlag(1)] [pulseLen_lo(1)] [pulseLen_hi(1)] [pulses(...)] [0x0D 0x05]
 *
 * Pulse encoding:
 *   ticks < 256  →  [ticks]              (1 byte)
 *   ticks ≥ 256  →  [0x00, hi, lo]       (3 bytes, big-endian value)
 */
class BroadlinkPacket {
  static TYPE_IR        = 0x26; // IR (Standard 38 kHz)
  static TYPE_RF433     = 0xb2; // RF 433 MHz (Standard)
  static TYPE_RF315     = 0xd7; // RF 315 MHz (Standard)
  static TYPE_RF433_ALT = 0xb3; // RF 433 MHz (Commonly used by RM4 Pro for learning feedback)
  static TYPE_RF_TC2    = 0xde; // RF (Specific to TC2 wall switches and newer RM4 variants)
  static TYPE_RF_CUSTOM = 0xe9; // RF (Legacy format or system-specific packet header)

  constructor(type = BroadlinkPacket.TYPE_IR) {
    this.type       = type;
    this.repeatFlag = 0x00; // 0 = first/only burst
    this._pulses    = [];   // encoded pulse bytes
  }

  /**
   * Append one pulse/space duration as Broadlink ticks.
   * @param {number} ticks  Integer tick count
   */
  addTicks(ticks) {
    if (ticks < 256) {
      this._pulses.push(ticks);
    } else {
      this._pulses.push(0x00, (ticks >> 8) & 0xff, ticks & 0xff);
    }
  }

  /**
   * Serialise to a Uint8Array ready to pass to send_IR_RF_data_*.
   * @returns {Uint8Array}
   */
  toUint8Array() {
    const len = this._pulses.length;
    return new Uint8Array([
      this.type,                        // packet type RF 433mHz, RF 315MHz, or IR
      this.repeatFlag,                  // repeat flag (0 = first/only burst; non-zero = repeat count or special flag)  
      len & 0xff, (len >> 8) & 0xff,    // pulse data length (little-endian)
      ...this._pulses,                  // pulse data (1 or 3 bytes per pulse, depending on tick count)
      0x0d, 0x05,                       // end marker
    ]);
  }
}

module.exports = BroadlinkPacket;
