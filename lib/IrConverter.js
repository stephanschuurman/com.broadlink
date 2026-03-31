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
const BroadlinkPacket = require('./BroadlinkPacket.js');

// More conversion options at:
// https://github.com/pasthev/sensus => https://pasthev.github.io/sensus/
// https://github.com/haimkastner/broadlink-ir-converter
// https://github.com/nogic1008/Broadlink-IR-Converter
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
   * Convert an array of pulse durations (µs) to a Broadlink-formatted Uint8Array.
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
   * Convert a Pronto hex string to a Broadlink IR Uint8Array (0x26 format).
   *
   * The Broadlink tick unit is 269/8192 ms ≈ 32.84 µs.
   * The device always transmits at its fixed carrier frequency (default 38 kHz for RM5+).
   * The pronto carrier frequency is used only to derive relative timing — the ticks stay
   * accurate regardless of the original carrier.
   *
   * @param {string} prontoHex    Space-separated pronto hex string (e.g. "0000 0073 ...")
   * @param {number} deviceFreq   Device carrier frequency in Hz (default: 38000)
   * @param {number} repetitions  Number of extra repeats encoded in repeatRaw's repeatFlag (device handles them)
   * @returns {{ mainRaw: Uint8Array, repeatRaw: Uint8Array|null, prontoFreq: number, freqWarning: boolean }}
   *   mainRaw     – Once burst, repeatFlag = 0x00
   *   repeatRaw   – Repeat burst, repeatFlag = repetitions; null when the pronto code has no repeat section
   *   prontoFreq  – Carrier frequency encoded in the pronto header (Hz)
   *   freqWarning – true when prontoFreq deviates >5% from deviceFreq
   */
  static prontoToBroadlink(prontoHex, deviceFreq = 38000, repetitions = 0) {
    const words = prontoHex.trim().split(/\s+/).map(h => parseInt(h, 16));
    const flag = repetitions > 1 ? Math.min(repetitions, 20) - 1 : 0x00; // device repeat count is 1–20; 0 means no repeat burst

    if (words.length < 4 || words[0] !== 0x0000) {
      throw new Error('Invalid pronto hex format');
    }

    const divider   = words[1];
    const onceLen   = words[2];
    const repeatLen = words[3];

    if (divider === 0) throw new Error('Invalid pronto hex: zero frequency divider');

    // Carrier frequency encoded in the pronto header
    const prontoFreq = 1_000_000 / (divider * 0.241246);
    const freqWarning = Math.abs(prontoFreq - deviceFreq) > deviceFreq * 0.05;

    // Convert pronto units directly to Broadlink ticks (no intermediate µs step to
    // avoid rounding error on large gap values).
    // ticks = floor(prontoUnit × divider × 0.241246 × 269 / 8192)
    const ticksPerUnit = divider * 0.241246 * 269 / 8192;

    const onceWords   = words.slice(4, 4 + onceLen * 2);
    const repeatWords = words.slice(4 + onceLen * 2, 4 + onceLen * 2 + repeatLen * 2);

    // Pronto burst semantics:
    //   onceLen > 0, repeatLen > 0  → mainWords = onceWords,  repeatN = repeatWords
    //   onceLen > 0, repeatLen = 0  → mainWords = onceWords,  repeatN = []  (no repeat)
    //   onceLen = 0, repeatLen > 0  → mainWords = repeatWords, repeatN = repeatWords (repeat same burst)
    const mainWords = onceLen > 0 ? onceWords : repeatWords;

    if (mainWords.length === 0) throw new Error('Pronto hex contains no pulse data');

    const buildPacket = (words) => {
      const pkt = new BroadlinkPacket(BroadlinkPacket.TYPE_IR);
      pkt.repeatFlag = flag;
      for (const pw of words) pkt.addTicks(Math.floor(pw * ticksPerUnit));
      return pkt.toUint8Array();
    };

    const mainRaw = buildPacket(mainWords, 0x00);
    return { mainRaw, prontoFreq, freqWarning };
  }

}

module.exports = IrConverter;
