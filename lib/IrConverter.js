"use strict";

const converter = require('broadlink-ir-converter');

// More conversion options at: 
// https://github.com/pasthev/sensus => https://pasthev.github.io/sensus/
// https://github.com/haimkastner/broadlink-ir-converter
// https://github.com/nogic1008/Broadlink-IR-Converter
// https://github.com/search?q=broadlink-ir-converter&type=repositories
// https://github.com/benfoxall/puckmote => https://benjaminbenben.com/puckmote/

/**
 * IR format conversion utilities for Broadlink devices.
 */
class IrConverter {

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
   * @param {number} repetitions  Number of times to send the repeat burst (default: 1)
   * @returns {{ raw: Uint8Array, prontoFreq: number, freqWarning: boolean }}
   *   raw         – Broadlink-formatted Uint8Array ready to send
   *   prontoFreq  – Carrier frequency encoded in the pronto header (Hz)
   *   freqWarning – true when prontoFreq deviates >5% from deviceFreq
   */
  static prontoToBroadlink(prontoHex, deviceFreq = 38000, repetitions = 1) {
    const words = prontoHex.trim().split(/\s+/).map(h => parseInt(h, 16));

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

    // Some pronto codes have burst1=0 and all data in burst2 (repeat section)
    const mainWords = onceLen > 0 ? onceWords : repeatWords;
    const repeatN   = repeatWords.length > 0 ? repeatWords : mainWords;

    const allWords = [
      ...mainWords,
      ...Array.from({ length: Math.max(0, repetitions - 1) }, () => repeatN).flat(),
    ];

    if (allWords.length === 0) throw new Error('Pronto hex contains no pulse data');

    // Encode pulses: values < 256 are stored as 1 byte; larger values as 3 bytes (00 hi lo)
    const arr = [];
    for (const pw of allWords) {
      const ticks = Math.floor(pw * ticksPerUnit);
      if (ticks < 256) {
        arr.push(ticks);
      } else {
        arr.push(0x00, (ticks >> 8) & 0xff, ticks & 0xff);
      }
    }

    // Broadlink 0x26 IR format:
    //   [0x26, 0x00, len_lo, len_hi, ...pulses, 0x0D, 0x05]
    // len = number of encoded pulse bytes (not counting the 0D 05 end marker)
    const raw = new Uint8Array([
      0x26, 0x00, arr.length & 0xff, (arr.length >> 8) & 0xff,
      ...arr,
      0x0d, 0x05,
    ]);

    return { raw, prontoFreq, freqWarning };
  }

}

module.exports = IrConverter;
