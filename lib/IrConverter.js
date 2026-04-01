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
   * @param {string} address  Hex string (1 byte), e.g. "00"
   * @param {string} command  Hex string (1 byte), e.g. "02"
   * @returns {{ mainRaw: Uint8Array, prontoFreq: number, freqWarning: boolean }}
   */
  static necToPronto(address, command) {
    /**
     * Helper function to handle both Numbers (255) and Hex Strings ("FF" or "0xFF")
     */
    const parseInput = (input) => {
      // If input is already a number, ensure it stays within 1-byte (0-255)
      if (typeof input === 'number') {
        return input & 0xFF;
      }

      // Parse strings: "0xFF" or "FF" → hex; "254" (only decimal digits) → decimal
      if (typeof input === 'string') {
        const isHex = /^0x/i.test(input) || /[a-f]/i.test(input);
        return (isHex ? parseInt(input, 16) : parseInt(input, 10)) & 0xFF;
      }

      throw new Error(`Unsupported input type: ${typeof input}`);
    };

    const addr = parseInput(address);
    const cmd = parseInput(command);

    // Validate that parsing resulted in valid numbers
    if (isNaN(addr) || isNaN(cmd)) {
      throw new Error('Address or command could not be parsed to a valid byte');
    }

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
   * @param {string} address  Hex string (1 byte), e.g. "00"
   * @param {string} command  Hex string (1 byte), e.g. "02"
   * @returns {string} Pronto hex string
   */
  static rc5ToPronto(address, command) {

  }

}

module.exports = IrConverter;
