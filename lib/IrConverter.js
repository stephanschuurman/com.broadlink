/**
 * Broadlink IR/RF packet and Pronto hex conversion utilities.
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

const { broadlinkToPulesArray, pulesArrayToBroadlink } = require('broadlink-ir-converter');
const BroadlinkPayloadPacket = require('./BroadlinkPayloadPacket.js');

// More conversion examples at:
// https://github.com/pasthev/sensus => https://pasthev.github.io/sensus/
// https://github.com/haimkastner/broadlink-ir-converter
// https://github.com/benfoxall/puckmote => https://benjaminbenben.com/puckmote/
// https://ushomeautomation.com/Projects/Broadlink-RM3-MQTTBridge/index.html

/**
 * IR format conversion utilities for Broadlink devices.
 */
class IrConverter {

  /**
   * Parse an integer argument from a number or string ("26", "0x1A" or "1A").
   *
   * A digits-only string is read as decimal; use the "0x" prefix to force hex.
   * The whole string must be a valid number: trailing garbage ("12x") is
   * rejected instead of silently truncated by parseInt.
   *
   * @param {number|string} input  Value to parse
   * @param {number} max   Highest allowed value (inclusive)
   * @param {string} name  Argument name, used in the error message
   * @returns {number} Parsed value in the range 0..max
   * @throws {Error} When the input is not a valid number or out of range
   */
  static parseIntArg(input, max, name) {
    let value = NaN;
    if (typeof input === 'number') {
      value = input;
    } else if (typeof input === 'string') {
      const s = input.trim();
      if (/^0x[0-9a-f]+$/i.test(s)) value = parseInt(s, 16);
      else if (/^[0-9]+$/.test(s)) value = parseInt(s, 10);
      else if (/^[0-9a-f]+$/i.test(s)) value = parseInt(s, 16);
    }
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(
        `${name} must be 0-${max} (or hex 0x0-0x${max.toString(16).toUpperCase()}), got "${input}"`
      );
    }
    return value;
  }

  /**
   * Convert a Broadlink IR/RF hex string to an array of pulse durations.
   *
   * The pulse array format is the same as Tasmota RawData:
   * alternating mark/space durations in µs.
   *
   * @param {string} broadlinkHex  Continuous hex string (e.g. "2600...")
   * @returns {{ freq: number, pulses: number[] }}
   *   freq   – Carrier frequency (0 = IR 38 kHz; non-zero = RF frequency byte)
   *   pulses – Alternating mark/space durations in µs
   */
  static broadlinkHexToPulses(broadlinkHex) {
    const arr = broadlinkToPulesArray(broadlinkHex.replace(/\s+/g, ''));
    return { freq: arr[0], pulses: arr.slice(1) };
  }

  /**
   * Convert an array of RAW pulse durations (µs) to a Broadlink-formatted Uint8Array.
   *
   * @param {number[]} pulses  Alternating mark/space durations in µs
   * @param {number}   freq    Carrier frequency byte (0 or 38 for IR; omit for IR)
   * @returns {Uint8Array}
   */
  static pulsesToBroadlink(pulses, freq = 0) {
    const hex = pulesArrayToBroadlink([freq, ...pulses]);
    const clean = hex.replace(/\s+/g, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  /**
   * Clean a raw learned IR/RF capture into a canonical Broadlink packet.
   *
   * Newer devices (RM4/RM5) return the raw measurement: AES block padding
   * after the length-covered data, a long lead-in value, one burst per
   * transmission seen, receiver bias on mark/space timing, and (RM5) the
   * measured carrier frequency in kHz as byte 0 instead of the fixed 0x26.
   *
   * Steps: cap at the packet's own length field, split the pulses into bursts
   * on long silences, drop bursts that are a (possibly truncated) repeat of
   * the longest burst, quantize durations per level with mark/space bias
   * correction, and rebuild as a standard packet. Bursts that genuinely
   * differ (e.g. air-conditioner frame pairs) are all kept, joined by their
   * measured gaps. Byte 0 becomes 0x26 for IR; RF type bytes are preserved.
   *
   * @param {Uint8Array} capture  Raw learned packet: [type][repeat][len LE][pulses...]
   * @returns {{ data: Uint8Array, carrier: number, burstsTotal: number, burstsKept: number } | null}
   *   Cleaned packet plus capture info, or null when no usable burst was found.
   *   `carrier` is the raw byte 0 of the capture (measured kHz on RM5).
   */
  static cleanCapture(capture) {
    const GAP_TICKS = 330;      // ~10 ms: longer values separate bursts
    const MIN_BURST = 3;        // bursts with fewer durations are noise
    const CLUSTER_RATIO = 1.35; // relative step that starts a new duration level
    const TRAILING_GAP = 3333;  // canonical 0x00 0x0d 0x05 end silence

    if (!capture || capture.length < 6) return null;
    const type = capture[0];
    const pulseLen = capture[2] | (capture[3] << 8);
    const end = 4 + pulseLen;
    const body = capture.subarray(4, end <= capture.length ? end : capture.length);

    // Decode durations: 1 byte, or 0x00 + 2 bytes big-endian for values >= 256
    const pulses = [];
    for (let i = 0; i < body.length; ) {
      if (body[i] === 0 && i + 2 < body.length) {
        pulses.push((body[i + 1] << 8) | body[i + 2]);
        i += 3;
      } else {
        pulses.push(body[i]);
        i += 1;
      }
    }

    // Split into bursts on long silences; the lead-in value before the first
    // burst and the trailing silence drop out here
    const segments = [];
    let current = [];
    for (const ticks of pulses) {
      if (ticks > GAP_TICKS) {
        if (current.length >= MIN_BURST) segments.push({ burst: current, gap: ticks });
        current = [];
      } else {
        current.push(ticks);
      }
    }
    if (current.length >= MIN_BURST) segments.push({ burst: current, gap: 0 });
    if (segments.length === 0) return null;

    // Cluster all burst durations into levels (short/long/...), then correct
    // receiver bias per level by averaging the mark and space means
    const all = [];
    for (const seg of segments) {
      seg.burst.forEach((ticks, idx) => all.push({ ticks, isMark: idx % 2 === 0 }));
    }
    const sorted = [...new Set(all.map((p) => p.ticks))].sort((a, b) => a - b);
    const clusterMax = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] / sorted[i - 1] > CLUSTER_RATIO) clusterMax.push(sorted[i - 1]);
    }
    clusterMax.push(sorted[sorted.length - 1]);
    const clusterOf = (ticks) => clusterMax.findIndex((max) => ticks <= max);

    const levels = clusterMax.map((max, idx) => {
      const members = all.filter((p) => clusterOf(p.ticks) === idx);
      const avg = (arr) => arr.reduce((sum, p) => sum + p.ticks, 0) / arr.length;
      const marks = members.filter((p) => p.isMark);
      const spaces = members.filter((p) => !p.isMark);
      if (marks.length && spaces.length) return Math.round((avg(marks) + avg(spaces)) / 2);
      return Math.round(avg(members));
    });
    const snap = (ticks) => levels[clusterOf(ticks)];

    // Drop bursts that repeat the longest burst; a shorter burst whose level
    // pattern is a suffix of the longest one is the same code with its first
    // duration(s) swallowed by the lead-in
    const patternOf = (burst) => burst.map((t) => clusterOf(t)).join(',');
    const longest = segments.reduce((a, b) => (b.burst.length > a.burst.length ? b : a));
    const longestPattern = patternOf(longest.burst);
    const kept = segments.filter(
      (seg) => seg === longest || !(',' + longestPattern).endsWith(',' + patternOf(seg.burst))
    );

    // Rebuild: single cleaned burst, or all distinct bursts with measured gaps
    const pkt = new BroadlinkPayloadPacket(type >= 0xb0 ? type : BroadlinkPayloadPacket.TYPE_IR);
    kept.forEach((seg, idx) => {
      seg.burst.forEach((ticks) => pkt.addTicks(snap(ticks)));
      if (idx < kept.length - 1) pkt.addTicks(seg.gap);
    });
    pkt.addTicks(TRAILING_GAP);

    return {
      data: pkt.toUint8Array(),
      carrier: type,
      burstsTotal: segments.length,
      burstsKept: kept.length,
    };
  }

  /**
   * Normalize a stored learned command before sending.
   *
   * Commands stored by older app versions carry the 2-byte response prefix
   * (0x00 0x00) and AES block padding around the actual packet. A Broadlink
   * packet never starts with 0x00, so a leading 0x00 0x00 is safely stripped;
   * the padding is dropped by capping at the packet's own length field.
   * Current-format commands pass through unchanged.
   *
   * @param {Uint8Array|number[]} data  Stored command data (legacy or current format)
   * @returns {Uint8Array}  [type][repeat][len LE][pulses], without prefix or padding
   */
  static normalizeStoredCommand(data) {
    let out = data instanceof Uint8Array ? data : Uint8Array.from(data || []);
    if (out.length < 6) return out;
    if (out[0] === 0x00 && out[1] === 0x00) {
      out = out.subarray(2);
    }
    const pulseLen = out[2] | (out[3] << 8);
    if (pulseLen > 0 && 4 + pulseLen <= out.length) {
      out = out.subarray(0, 4 + pulseLen);
    }
    return out;
  }

  /**
   * Convert a Broadlink base64 string to a Broadlink hex string.
   *
   * @param {string} base64  Base64-encoded Broadlink packet
   * @returns {string}       Continuous hex string (e.g. "2600...")
   */
  static broadlinkBase64toBroadlinkHex(base64) {
    return Buffer.from(base64, 'base64').toString('hex');
  }

  /**
   * Convert a Broadlink hex string to a base64 string.
   *
   * @param {string} hex  Continuous hex string (e.g. "2600...")
   * @returns {string}    Base64-encoded Broadlink packet
   */
  static broadlinkHexToBroadlinkBase64(hex) {
    if (ArrayBuffer.isView(hex)) {
      return Buffer.from(hex).toString('base64');
    }
    return Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('base64');
  }

  /**
   * Format a Uint8Array as a space-separated hex string (for debug logging).
   * @param {Uint8Array} u8
   * @returns {string}  e.g. "26 00 20 ..."
   */
  static toHex(u8) {
    return Buffer.from(u8).toString('hex').replace(/../g, '$& ').trimEnd();
  }

  /**
   * Format a Uint8Array as a continuous hex string (no spaces).
   * @param {Uint8Array} u8
   * @returns {string}  e.g. "26002600..."
   */
  static toHexCompact(u8) {
    return Buffer.from(u8).toString('hex');
  }

  /**
   * Convert a Broadlink base64 string directly to a Uint8Array.
   * @param {string} base64  Base64-encoded Broadlink packet
   * @returns {Uint8Array}
   */
  static broadlinkBase64toUint8Array(base64) {
    return Buffer.from(base64, 'base64');
  }

  /**
   * Convert a Pronto hex string to a Broadlink IR Uint8Array (0x26 format).
   *
   * The Broadlink tick unit is 269/8192 ms ≈ 32.84 µs.
   * The device always transmits at its fixed carrier frequency (default 38 kHz for RM5+).
   * The pronto carrier frequency is used only to derive relative timing — the ticks stay
   * accurate regardless of the original carrier.
   *
   * @param {string} prontoHex    Space-separated pronto hex string (e.g. "0000 0073 ...")
   * @param {number} deviceFreq   Device carrier frequency in Hz (default: 38029)
   * @param {number} repetitions  Number of extra repeats encoded in repeatRaw's repeatFlag (device handles them)
   * @returns {{ mainRaw: Uint8Array, repeatRaw: Uint8Array|null, prontoFreq: number, freqWarning: boolean }}
   *   mainRaw     – Once burst, repeatFlag = 0x00
   *   repeatRaw   – Repeat burst, repeatFlag = repetitions; null when the pronto code has no repeat section
   *   prontoFreq  – Carrier frequency encoded in the pronto header (Hz)
   *   freqWarning – true when prontoFreq deviates >5% from deviceFreq
   */
  static prontoToBroadlink(prontoHex, deviceFreq = 38029, repetitions = 0) {
    const words = prontoHex.trim().split(/\s+/).map(h => parseInt(h, 16));
    const flag = repetitions > 1 ? Math.min(repetitions, 20) - 1 : 0x00; // device repeat count is 1–20; 0 means no repeat burst

    if (words.length < 4 || words[0] !== 0x0000) {
      throw new Error('Invalid pronto hex format');
    }

    const divider = words[1];
    const onceLen = words[2];
    const repeatLen = words[3];

    if (divider === 0) throw new Error('Invalid pronto hex: zero frequency divider');

    // Carrier frequency encoded in the pronto header
    const prontoFreq = 1_000_000 / (divider * 0.241246);
    const freqWarning = Math.abs(prontoFreq - deviceFreq) > deviceFreq * 0.05;

    // Convert pronto units directly to Broadlink ticks (no intermediate µs step to
    // avoid rounding error on large gap values).
    // ticks = floor(prontoUnit × divider × 0.241246 × 269 / 8192)
    const ticksPerUnit = divider * 0.241246 * 269 / 8192;

    const onceWords = words.slice(4, 4 + onceLen * 2);
    const repeatWords = words.slice(4 + onceLen * 2, 4 + onceLen * 2 + repeatLen * 2);

    // Pronto burst semantics:
    //   onceLen > 0, repeatLen > 0  → mainWords = onceWords,  repeatN = repeatWords
    //   onceLen > 0, repeatLen = 0  → mainWords = onceWords,  repeatN = []  (no repeat)
    //   onceLen = 0, repeatLen > 0  → mainWords = repeatWords, repeatN = repeatWords (repeat same burst)
    const mainWords = onceLen > 0 ? onceWords : repeatWords;

    if (mainWords.length === 0) throw new Error('Pronto hex contains no pulse data');

    const buildPacket = (words) => {
      const pkt = new BroadlinkPayloadPacket(BroadlinkPayloadPacket.TYPE_IR);
      pkt.repeatFlag = flag;
      for (const pw of words) pkt.addTicks(Math.floor(pw * ticksPerUnit));
      return pkt.toUint8Array();
    };

    const mainRaw = buildPacket(mainWords, 0x00);
    return { mainRaw, prontoFreq, freqWarning };
  }

  /**
   * Convert a Broadlink IR packet to a learned-format Pronto hex string.
   *
   * The inverse of prontoToBroadlink. The Pronto header carries the carrier
   * frequency: pass `carrierKhz` explicitly (e.g. the measured value from a
   * cleaned RM5 capture), or leave it null to take byte 0 of the packet — the
   * RM5 reports the measured carrier in kHz there. Values outside the
   * plausible IR range (20-60 kHz, e.g. RF type bytes) fall back to 38 kHz.
   *
   * @param {Uint8Array} capture  Broadlink packet: [type][repeat][len LE][pulses...]
   * @param {number|null} carrierKhz  Carrier in kHz, or null to derive from byte 0
   * @returns {string|null}  Space-separated pronto hex words, or null when unusable
   */
  static broadlinkToPronto(capture, carrierKhz = null) {
    if (!capture || capture.length < 6) return null;
    const pulseLen = capture[2] | (capture[3] << 8);
    const end = 4 + pulseLen;
    const body = capture.subarray(4, end <= capture.length ? end : capture.length);

    const pulses = [];
    for (let i = 0; i < body.length; ) {
      if (body[i] === 0 && i + 2 < body.length) {
        pulses.push((body[i + 1] << 8) | body[i + 2]);
        i += 3;
      } else {
        pulses.push(body[i]);
        i += 1;
      }
    }
    if (pulses.length === 0) return null;

    // Pronto data is (on, off) pairs; a capture ending on a mark gets the
    // canonical trailing silence appended
    if (pulses.length % 2 !== 0) pulses.push(0x0d05);

    let khz = carrierKhz ?? capture[0];
    if (!(khz >= 20 && khz <= 60)) khz = 38;
    const divider = Math.round(1_000_000 / (khz * 1000 * 0.241246));

    // Broadlink tick (8192/269 µs) → pronto unit (divider × 0.241246 µs)
    const unitsPerTick = (8192 / 269) / (divider * 0.241246);
    const toUnits = (ticks) => Math.min(0xffff, Math.max(1, Math.round(ticks * unitsPerTick)));

    const words = [0x0000, divider, pulses.length / 2, 0x0000, ...pulses.map(toUnits)];
    return words.map((w) => w.toString(16).toUpperCase().padStart(4, '0')).join(' ');
  }

  /**
   * Convert a NEC address and command to a Broadlink IR Uint8Array.
   *
   * Encodes the 4-byte NEC sequence (addr, ~addr, cmd, ~cmd) into Pronto hex,
   * then converts it to Broadlink format via prontoToBroadlink.
   *
   * NEC protocol basics:
   * - 32 bits: address (8), address_inv (8), command (8), command_inv (8)
   * - 9000µs mark, 4500µs space (AGC burst), then 32 data bits:
   *   - '0' bit: 560µs mark + 560µs space
   *   - '1' bit: 560µs mark + 1690µs space
   *
   * @param {number|string} address  0-255, decimal ("26") or hex ("0x1A")
   * @param {number|string} command  0-255, decimal ("26") or hex ("0x1A")
   * @returns {{ mainRaw: Uint8Array, prontoFreq: number, freqWarning: boolean }}
   */
  static necToPronto(address, command) {
    const addr = IrConverter.parseIntArg(address, 0xFF, 'NEC address');
    const cmd = IrConverter.parseIntArg(command, 0xFF, 'NEC command');

    // NEC Protocol Structure: [Address] [Inverted Address] [Command] [Inverted Command]
    const fullHex = [
      addr,
      (~addr) & 0xFF,
      cmd,
      (~cmd) & 0xFF
    ]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');

    // Pass the 8-character hex string to your converter
    return IrConverter.necHexToPronto(fullHex);
  }

  /**
   * Convert a NEC hex string to a Pronto hex string.
   * @param {string} necHex - NEC hex string (8 characters, e.g., "00FF02FD")
   * @returns {string} Pronto hex string
   */
  static necHexToPronto(necHex) {
    // NEC transmits bits LSB-first; iterate over bytes (2 hex chars each)
    const bits = [];
    for (let i = 0; i < necHex.length; i += 2) {
      const byte = parseInt(necHex.slice(i, i + 2), 16);
      for (let b = 0; b <= 7; b++) {        // LSB first
        bits.push((byte >> b) & 1);
      }
    }

    const prontoParts = [
      '0000', // Pronto code type
      '006C', // Frequency divider (~38 kHz)
      '0022', // 34 pairs = 68 data words (1 AGC + 32 bits + 1 stop)
      '0000'  // No repeat sequence
    ];

    // AGC burst: 9000µs mark + 4500µs space
    prontoParts.push('015B', '00AD');

    // 32 data bits – each is a (mark, space) pair
    for (const bit of bits) {
      prontoParts.push('0016');                        // 560µs mark
      prontoParts.push(bit === 0 ? '0016' : '0041');  // 560µs / 1690µs space
    }

    // Final stop mark + long trailing gap
    prontoParts.push('0016', '05F7');

    return prontoParts.join(' ');
  }

  /**
   * Convert an RC5 address and command to a Pronto hex string, then to Broadlink format.
   * @param {number|string} address  0-31, decimal ("26") or hex ("0x1A")
   * @param {number|string} command  0-63, decimal ("26") or hex ("0x1A")
   * @returns {string} Pronto hex string
   */
  static rc5ToPronto(address, command, toggle = 1) {
    const addr = IrConverter.parseIntArg(address, 0x1F, 'RC5 address');
    const cmd = IrConverter.parseIntArg(command, 0x3F, 'RC5 command');
    const tgl = IrConverter.parseIntArg(toggle, 0x01, 'RC5 toggle');

    const carrierFreq = 0x0073;
    const halfBitCycles = 0x0020;

    // RC5 frame: start1(1), start2(1), toggle(0/1), address(5), command(6)
    const bits = (1 << 13) | (1 << 12) | (tgl << 11) | ((addr & 0x1F) << 6) | (cmd & 0x3F);

    // Manchester coding mapped to mark/space half bits
    const halfBits = [];
    for (let i = 13; i >= 0; i--) {
      const bit = (bits >> i) & 1;
      if (bit === 1) {
        halfBits.push(1, 0);
      } else {
        halfBits.push(0, 1);
      }
    }

    // Pronto expects durations from a half-bit boundary
    const framedHalfBits = halfBits.slice(1);

    const durations = [];
    let currentVal = framedHalfBits[0];
    let count = 1;

    for (let i = 1; i < framedHalfBits.length; i++) {
      const val = framedHalfBits[i];
      if (val === currentVal) {
        count += 1;
      } else {
        durations.push(count * halfBitCycles);
        currentVal = val;
        count = 1;
      }
    }
    durations.push(count * halfBitCycles);

    // Finish with a long trailing gap
    if (durations.length % 2 === 0) {
      durations[durations.length - 1] = 0x0CC8;
    } else {
      durations.push(0x0CC8);
    }

    const header = [0x0000, carrierFreq, 0x0000, durations.length / 2];
    return [...header, ...durations].map(x => x.toString(16).padStart(4, '0')).join(' ');
  }


}

module.exports = IrConverter;
