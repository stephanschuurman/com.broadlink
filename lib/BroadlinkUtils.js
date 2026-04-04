/**
 * Driver for Broadlink devices
 *
 * Copyright 2018-2026, R Wensveen, Stephan Schuurman (stephanschuurman.com)
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

//const Log = require('homey-log').Log;
const DeviceInfo = require("./DeviceInfo");

/*
 * homey-log sends error reports to Sentry.IO
 * in env.js its DSN is defined.
 * log in to Sentry.IO with your github account to view the events.
 */

class BroadlinkUtils {
  constructor(homey) {
    this.homey = homey;
  }

  epochToTimeFormatter(epoch) {
    if (epoch == null) epoch = new Date().getTime();
    return new Date(epoch).toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, "$1");
  }

  concatTypedArrays(a, b) {
    if (!a || !b) {
      this.debugLog(null, "Invalid array inputs for concatenation", { a, b });
    }
    var c = new a.constructor(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
  }

  hexDigit(b) {
    const nibble = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F"];
    let l = b & 0x0f;
    let h = (b >> 4) & 0x0f;
    return "" + nibble[h] + nibble[l];
  }

  /**
   *  Convert an Array (might be typed) to a human reabable string,
   *  where each byte is separated by a comma
   */
  asHex(arr, separator) {
    if (!arr) {
      this.debugLog(null, "Invalid array input for hex conversion", arr);
    }
    if (separator == null) {
      separator = ",";
    }
    var s = Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      s[i] = this.hexDigit(arr[i]);
    }
    return Array.apply([], s).join(separator);
  }

  /**
   *  Convert an Array (might be typed) to a string,
   *  without any separation characters
   */
  arrToHex(arr) {
    if (arr == null) { 
      //this.debugLog(null, "Invalid array input for hex conversion", arr);
      return "";
    }
    var s = Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      s[i] = this.hexDigit(arr[i]);
    }
    return Array.apply([], s).join("");
  }

  /**
   * Convert a string with hex-representation to a
   * typed array with bytes.
   * example:  hexToArr( '12A4F0D8' ) -> Uint8Array([ 0x12, 0xA4, 0xF0, 0xD8 ])
   * @param {string} str 
   * @returns {Uint8Array|null}
   */
  hexToArr(str) {
    if (str == null) { 
      //this.debugLog(null, "Invalid string input for array conversion", str);
      return null;
    }
    for (var bytes = [], c = 0; c < str.length; c += 2) {
      bytes.push(parseInt(str.slice(c, c + 2), 16));
    }
    return new Uint8Array(bytes);
  }

  /**
   * Convert a string with hex-representation to a Buffer with bytes.
   * @param {string} str 
   * @returns {Buffer|null}
   */
  hexToBuffer(str) {
    if (str == null || str.length % 2 !== 0 || str.length < 3) { 
      return null;
    }
    const arr = this.hexToArr(str);
    const reordered = [arr[2], arr[1], arr[0], ...arr.slice(3)];
    return Buffer.from(reordered);
  }

  /**
   * Convert a Buffer containing the full discovery response to a human readable MAC address string
   * by taking the 6 bytes starting from offset 0x3a, and converting them to hex with ":" separation.
   * @param {Buffer} buffer 
   * @returns {string}
   */
  bufferToMacReadable(buffer) {
    return Array.from(buffer).map((byte) => byte.toString(16).padStart(2, "0")).join(":");
  }

  /**
   * Normalize MAC-like values by removing separators and uppercasing hex digits.
   * @param {string|Buffer|Uint8Array|Array<number>} value
   * @returns {string}
   */
  normalizeMac(value) {
    if (value == null) {
      return "";
    }

    if (Buffer.isBuffer(value) || value instanceof Uint8Array || Array.isArray(value)) {
      return this.arrToHex(value).toUpperCase();
    }

    return value.toString().replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  }


  /**
   * Gets the IP address of this Homey (i.e. our own IP address)
   *
   * return: [Promise]
   *         from Promise, return IP address
   */
  getHomeyIp() {
    return new Promise((resolve, reject) => {
      this.homey.cloud
        .getLocalAddress()
        .then((localAddress) => {
          return resolve(localAddress);
        })
        .catch((error) => {
          this.debugLog(null, "Error getting Homey IP address", error);
          throw new Error(error);
        });
    });
  }

  /**
   * Gets the IP address of this Homey without any port number that might be included in the result of getHomeyIp()
   * @returns {Promise<string>} Promise that resolves to the IP address without port
   */
  getHomeyIpWithoutPort() {
    return this.getHomeyIp().then((localAddress) => {
      let i = localAddress.indexOf(":");
      if (i > 0) {
        localAddress = localAddress.slice(0, i);
      }
      return localAddress;
    });
  }

  debugLog(device, message, data) {
    // Calculate deviceType in hexadecimal format
    const deviceType =
      device && typeof device.getData === "function" ? `0x${parseInt(device.getData().devtype, 10).toString(16)}` : "Unknown";

    const deviceDetails =
      device && typeof device.getData === "function" ? `${device.getData().name} (Type: ${deviceType})` : "Broadlink";

    const logMessage = `[${deviceDetails}] ${message}`;

    // Temporarily enable logging for all installations
    console.log(`${this.epochToTimeFormatter()} ${logMessage}`, data || "");

    // Check if the 'homey' and 'settings' are available in the device context
    // if (device && device.homey && device.homey.settings) {
    //     const settings = device.homey.settings.get('DebugSettings');
    //     if (settings && settings['logging']) {
    //         console.log(`${this.epochToTimeFormatter()} ${logMessage}`, data || '');
    //     }
    //     if (settings && settings['errorreport']) {
    //         Log.captureMessage(`${logMessage} ${data || ''}`);
    //     }
    // } else {
    //     // Fallback logging if settings are not available
    //     console.log(`${this.epochToTimeFormatter()} ${logMessage}`, data || '');
    // }
  }

  getDeviceInfo(founddevID, expectedType) {
    var foundInfo = DeviceInfo.devType2Info(founddevID);
  
    if (foundInfo.type == expectedType) {
      foundInfo.isCompatible = true;
    }
  
    let s = this.homey.settings.get("DebugSettings");
    if (s && s["compat"]) {
      foundInfo.isCompatible = true;
    }
    this.debugLog(
      null, 
      "getDeviceInfo: found = 0x" +
        founddevID.toString(16) +
        "  expectedType = " +
        expectedType +
        "  isComp = " +
        foundInfo.isCompatible
    );
    return foundInfo;
  }
}

module.exports = BroadlinkUtils;
