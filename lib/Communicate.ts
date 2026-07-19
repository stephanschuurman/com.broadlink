/**
 * Driver for Broadlink devices
 *
 * Copyright 2018-2019, R Wensveen + S Schuurman (stephanschuurman.com)
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

// Implementation based on the following sources:
// - https://github.com/kiwi-cam/broadlinkjs-rm/blob/master/index.js
// - https://github.com/mjg59/python-broadlink
// - https://github.com/mlfunston/node-red-contrib-broadlink-control

"use strict";

const dgram = require("dgram");
const BroadlinkUtils = require("./BroadlinkUtils.js");

import {
  HelloCommandPacket,
  HelloResponsePacket,
  AuthCommandPacket,
  AuthResponsePacket,
  RawEncryptedPacket,
} from './BroadLink/protocol';

const MAX_LOG_LENGTH = 500; // Maximum length of the logged response

// Constants for initial key and vector, as used in the authentication process
const DEFAULT_KEY = "097628343fe99e23765c1513accf8b02";
const DEFAULT_VECT = "562e17996d093d28ddb3ba695a2e6f58";

// Constants for default network settings
const DEFAULT_BCAST_ADDR = "255.255.255.255";
const DEFAULT_PORT = 80;
const DEFAULT_RETRY_INTVL = 1;
const DEFAULT_TIMEOUT = 10;


type SendCallback = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

type CommunicateOptions = {
  count: number;
  deviceType?: number;
  mac?: Uint8Array;
  ipAddress?: string;
  key?: Uint8Array;
  id?: Uint8Array;
  homey: any;
};

class Communicate {
  count = 0;
  deviceType = 0;
  ipAddress = DEFAULT_BCAST_ADDR;
  id = new Uint8Array([0, 0, 0, 0]);
  mac = new Uint8Array([0, 0, 0, 0, 0, 0]);
  key = new Uint8Array(DEFAULT_KEY.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  iv = new Uint8Array(DEFAULT_VECT.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  checkRepeatCount = 0;
  homey: any;
  _utils: any;
  dgramSocket: any;
  tm: any;
  callback: SendCallback | null = null;
  onAuthSuccess: ((id: Uint8Array, key: Uint8Array) => void) | null = null;
  _sendBusy: Promise<void> = Promise.resolve();
  _expectedCount: number | null = null;
  // Cached BROADLINK_TEST_IP from env.json; undefined = not read yet, null = not set
  static _testIpOverride: string | null | undefined = undefined;

  /**
   * Serialize requests on the shared socket: only one request/response
   * exchange may be in flight at a time, otherwise responses can end up
   * resolving the wrong caller's promise.
   *
   * @return release function to call when the exchange is done
   */
  async _acquireSendLock(): Promise<() => void> {
    const previous = this._sendBusy;
    let release: () => void = () => undefined;
    this._sendBusy = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  /**
   * options = { count: this.count,			// integer
   *			mac:   this.mac,				// Uint8Array[6]
   *			ipAddress: this.ipAddress		// string: '123.123.123.123'
   *
   *			key: this.key   // might be null // Uint8Array[16]
   *			id:  this.id	// might be null // Uint8Array[4]
   *		}
   *
   *  Note: all options (except 'count') are strings
   */
  configure(options: CommunicateOptions) {
    this.count = options.count;
    this.deviceType = options.deviceType ?? 0;

    // Get the homey instance and store it in the utils class
    this._utils = new BroadlinkUtils(options.homey);

    // Also set the homey instance to this class as a property
    this.homey = options.homey;

    if (options.ipAddress) {
      this.ipAddress = options.ipAddress;
    } else {
      this.ipAddress = "255.255.255.255";
    }

    if (options.id) {
      this.id = new Uint8Array(options.id);
    } else {
      this.id = new Uint8Array([0, 0, 0, 0]);
    }

    if (options.mac) {
      this.mac = new Uint8Array(options.mac);
    } else {
      this.mac = new Uint8Array([0, 0, 0, 0, 0, 0]);
    }
    if (options.key && options.key.length == 16) {
      this.key = new Uint8Array(options.key);
    } else {
      this.key = new Uint8Array(DEFAULT_KEY.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    }
    this.iv = new Uint8Array(DEFAULT_VECT.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    this.checkRepeatCount = 0;
  }

  /**
   * Update the IPaddress. No-op (and no log) when the address is unchanged.
   */
  setIPaddress(address: string) {
    if (address === this.ipAddress) return;
    this.ipAddress = address;
    this._utils.debugLog(this, `IP Address updated to: ${this.ipAddress}`);
  }

  /**
   *
   */
  destroy() {
    if (this.dgramSocket !== undefined) {
      clearTimeout(this.tm);
      this.tm = undefined;
      this.dgramSocket.close();
      this.dgramSocket = undefined;
      this.callback = null;
    }
  }

  /**
   *
   * @return [Promise]
   */
  async sendto(packet: Uint8Array, ipaddress: string, port: number, timeout: number, expectedCount: number | null = null): Promise<any> {
    this._expectedCount = expectedCount;
    if (this.dgramSocket === undefined) {
      this._utils.debugLog(this, "==> Communicate.sendto - create socket", packet, ipaddress, port);
      this.callback = {
        resolve: () => undefined,
        reject: () => undefined,
      };
      this.dgramSocket = dgram.createSocket("udp4");

      // Allow broadcast messages to be sent from this socket
      this.dgramSocket.bind(() => {
        this.dgramSocket.setBroadcast(true);
      });

      this.dgramSocket.on("error", (err) => {
        this._utils.debugLog(this, "**> dgramSocket error" + err);
        clearTimeout(this.tm);
        this.tm = undefined;
        this.callback.reject(Error(err.stack));
      });

      this.dgramSocket.on("message", (msg, rinfo) => {
        // A delayed answer to an earlier (timed-out) request must not resolve
        // the current one; the response echoes the packet count at 0x28-0x29
        if (this._expectedCount !== null && msg.length >= 0x2a) {
          const countEcho = msg[0x28] | (msg[0x29] << 8);
          if (countEcho !== this._expectedCount) {
            this._utils.debugLog(this, `<== Communicate.sendto - stale response (count ${countEcho}, expected ${this._expectedCount}), ignoring`);
            return;
          }
        }
        clearTimeout(this.tm);
        this.tm = undefined;
        let rsp = {
          data: msg, // msg is type Buffer
          size: rinfo.size,
          address: rinfo.address,
          port: rinfo.port,
        };
        this._utils.debugLog(this, "<== Communicate.sendto - got message with size=" + rsp["size"]);
        this.callback.resolve(rsp);
      });
    }

    return new Promise<any>(
      function (resolve, reject) {
        this.callback.reject = reject;
        this.callback.resolve = resolve;
        this.dgramSocket.send(packet, port, ipaddress);
        const hexData = this._utils.asHex(packet); // Convert packet to HEX
        this._utils.debugLog(this, `==> Communicate.sendto - send packet to ${ipaddress}:${port}. Data: ${hexData}`);

        this.tm = setTimeout(
          function () {
            clearTimeout(this.tm);
            this.tm = undefined;
            this._utils.debugLog(this, "**> dgramSocket timeout");
            if (this.dgramSocket !== undefined) {
              this.dgramSocket.close();
              this.dgramSocket = undefined;
            }
            reject(Error(this.homey.__("errors.sending timeout")));
          }.bind(this),
          timeout * 1000
        ); // timeout in [msec]
      }.bind(this)
    );
  }

  /**
   *
   * @return [Buffer] with response message
   */
  async send_packet(command: number, version: boolean, payload: Uint8Array, _authRetried = false, attempts = 2): Promise<any> {
    this._utils.debugLog(this, "->send_packet: payload=" + this._utils.asHex(payload));
    const originalPayload = payload;

    this.count = (this.count + 1) & 0xffff;
    const packetCount = this.count;

    // Build the request with the packet classes: the basic header, extended
    // header (device id + payload checksum) and the AES-128-CBC encryption of
    // the payload are all handled by RawEncryptedPacket.
    const request = new RawEncryptedPacket(command);
    request.header.deviceType = this.deviceType;
    request.header.packetCount = packetCount;
    // Legacy behaviour: the MAC address is written to the wire in reversed byte order
    request.header.macAddress = Array.from(this.mac)
      .reverse()
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(":");
    request.deviceId = (this.id[0] | (this.id[1] << 8) | (this.id[2] << 16) | (this.id[3] << 24)) >>> 0;
    request.key = Buffer.from(this.key);
    request.payload = Buffer.from(payload);
    const packet = request.toBuffer();

    // send packet with a single retry; the lock serializes exchanges on the
    // shared socket so responses cannot cross between concurrent callers
    const releaseSendLock = await this._acquireSendLock();
    let response;
    let lastError;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          response = await this.sendto(packet, this.ipAddress, 80, 5, packetCount);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          this._utils.debugLog(this, `send_packet attempt ${attempt} error: ${message}`);
          if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    } finally {
      releaseSendLock();
    }
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      return {
        error: -1,
        message,
        data: null,
        payload: null,
        cmd: null,
      };
    }

    if (response && response.data) {
      const responseHex = this._utils.asHex(response.data);
      this._utils.debugLog(
        this,
        "->send_packet - response= " +
        (responseHex.length > MAX_LOG_LENGTH ? responseHex.substring(0, MAX_LOG_LENGTH) + "..." : responseHex)
      );
    }

    if (response) {
      // Keep the unsigned error semantics used by callers (e.g. 0xfffb in _check_data)
      response.error = response.data[0x22] | (response.data[0x23] << 8);
      if (response.error == 0) {
        this._utils.debugLog(this, " No error received, error code : " + response.error);
        // Parse (and decrypt) the response with the packet classes; the
        // plaintext still contains the AES zero padding, as callers expect
        const responsePacket = RawEncryptedPacket.from(Buffer.from(response.data), Buffer.from(this.key));
        const r = responsePacket.payload;
        response.cmd = new Uint8Array(r.subarray(0, 4)); // get first 4 bytes in array
        response.payload = new Uint8Array(r.subarray(0x04)); // remove first 4 bytes of array

        this._utils.debugLog(
          this,
          "<-send_packet: payload =" +
          this.ipAddress +
          ": cmd :" +
          (this._utils.asHex(response.cmd).length > MAX_LOG_LENGTH
            ? this._utils.asHex(response.cmd).substring(0, MAX_LOG_LENGTH) + "..."
            : this._utils.asHex(response.cmd)) +
          ":" +
          " resp " +
          (this._utils.asHex(response.payload).length > MAX_LOG_LENGTH
            ? this._utils.asHex(response.payload).substring(0, MAX_LOG_LENGTH) + "..."
            : this._utils.asHex(response.payload))
        );
      } else if (response.error === 0xfff9 && !_authRetried) {
        this._utils.debugLog(this, `send_packet: auth error (0x${response.error.toString(16)}), re-authenticating...`);
        try {
          const authData = await this.auth();
          if (this.onAuthSuccess) this.onAuthSuccess(authData.id, authData.key);
          return this.send_packet(command, version, originalPayload, true, attempts);
        } catch (authErr) {
          const msg = authErr instanceof Error ? authErr.message : String(authErr);
          this._utils.debugLog(this, `send_packet: re-auth failed: ${msg}`);
        }
      } else {
        this._utils.debugLog(this, ` We got error, code = 0x${(response.error).toString(16).padStart(4, '0')}`);
      }
    } else {
      this._utils.debugLog(this, " We got error = " + (response ? response.error : "no response"));
      response = response || {};
      response.error = -1;
    }

    return response;
  }

  /**
   * Authenticate device.
   * - encrypt/decrypt keys are default ones.
   * - from response, the encrypt/decrypt keys for further communication can be retrieved.
   *
   * @return  key and id
   */
  async auth() {
    // The auth packet must be encrypted with the default key/iv and sent with
    // device id 0; the device responds with a new session key and id.
    this.id = new Uint8Array([0, 0, 0, 0]);
    this.key = new Uint8Array(DEFAULT_KEY.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    this.iv = new Uint8Array(DEFAULT_VECT.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));

    // Build the auth payload with the packet class (device identifier of 15
    // ASCII '1's and client name "Test  1", matching the previous behaviour)
    const authCommand = new AuthCommandPacket();
    authCommand.payload.deviceIdentifier = "111111111111111";
    authCommand.payload.clientName = "Test  1";
    const payload = new Uint8Array(authCommand.encodePlainPayload());

    // auth command = 0x65, version = false; _authRetried = true so a failed
    // auth can never trigger another re-auth (infinite recursion)
    let response = await this.send_packet(0x65, false, payload, true);
    if (!response || !response.payload) {
      this._utils.debugLog(this, "**> auth: decrypt payload error");
      throw new Error(this.homey.__("errors.decrypt_payload"));
    }

    // Parse the response with the packet class: device id + 16-byte session key
    const authResponse = AuthResponsePacket.from(Buffer.from(response.data));
    const key = new Uint8Array(authResponse.sessionKey);
    if (key.length % 16 != 0) {
      this._utils.debugLog(this, "**> auth: keylength error");
      throw new Error(this.homey.__("errors.decrypt_keylength") + key.length);
    }
    const idBuffer = Buffer.alloc(4);
    idBuffer.writeUInt32LE(authResponse.payload.deviceId, 0);
    const id = new Uint8Array(idBuffer);
    this.id = id;
    this.key = key;
    let authData = {
      id: id,
      key: key,
    };
    // Format the authentication data manually for logging (key redacted)
    const authDataFormatted = {
      id: Array.from(this.id)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      key: `[redacted, ${this.key.length} bytes]`,
    };

    this._utils.debugLog(this, `<== auth: auth data : id: ${authDataFormatted.id}, key: ${authDataFormatted.key}`);

    return authData;
  }

  /**
   * Discover Broadlink devices in the network. 
   * Either an IP address of the device is given, or the broadcast address is used.
   * Note that for a broadcast address, multiple devices might be discovered.
   * If local_ip_address is given, discovery will be done for that specific IP address, otherwise a broadcast will be used. 
   * @param {number} timeout Timeout (or scan-time) in milliseconds ( during tests: 10 - 110 ms )
   * @param {string|null} local_ip_address 
   * @param {string|null} device_ip_address 
   * @returns {Promise<Array>} Array of discovered devices
   */
  async discover(timeout, local_ip_address, device_ip_address) {
    if (local_ip_address == null) {
      throw new Error(this.homey.__("errors.discover_local_ip"));
    }

    // if not given, use broadcast address
    if (device_ip_address == null) 
      device_ip_address = "255.255.255.255";

    // Allow overriding the target IP via env.json (useful when broadcasts are blocked, e.g. in Docker/homey app run)
    // Add { "BROADLINK_TEST_IP": "192.168.1.xxx" } to env.json in the project root
    // Read once and cache: the SDK warns on every access of an unset env variable
    if (Communicate._testIpOverride === undefined) {
      const Homey = require('homey');
      Communicate._testIpOverride = Homey.env.BROADLINK_TEST_IP || null;
    }
    if (Communicate._testIpOverride) {
      device_ip_address = Communicate._testIpOverride;
      this._utils.debugLog(this, `[discover] BROADLINK_TEST_IP override: ${device_ip_address}`);
    }

    // Resolve immediately for unicast (specific IP); wait full timeout for broadcast to collect all devices
    let isBroadcast = device_ip_address === "255.255.255.255" || device_ip_address === "224.0.0.251";

    var port = 44488; // any random port will do.

    // Build the hello (discovery) packet with the packet class
    const helloPacket = new HelloCommandPacket(local_ip_address, port);
    const packet = helloPacket.toBuffer();

    // Set start time for discovery to calculate response times of devices
    const startNs = process.hrtime.bigint();

    // Use a dedicated socket so we can collect all responses until timeout
    return new Promise<any[]>((resolve, reject) => {
      const sock = dgram.createSocket("udp4");
      const results: any[] = [];

      sock.bind(() => {
        sock.setBroadcast(true);
        sock.send(packet, 80, device_ip_address, (err) => {
          if (err) {
            sock.close();
            return reject(err);
          }
          this._utils.debugLog(this, `==> Communicate.discover - sent broadcast to ${device_ip_address}`);
        });
      });

      sock.on("message", (msg, rinfo) => {
        this._utils.debugLog(this, `<== Communicate.discover - response from ${rinfo.address}:${rinfo.port}`);

        // Validate message length and source port to filter out irrelevant messages (e.g. from other devices or services)
        // 50?
        if (msg.length < 0x50 || rinfo.size < 0x50) {
          this._utils.debugLog(this, `**> Communicate.discover - ignoring short message from ${rinfo.address} with length ${msg.length}`);
          return;
        }

        // if (rinfo.port !== 80) {
        //   this._utils.debugLog(this, `**> Communicate.discover - ignoring message from ${rinfo.address} with unexpected port ${rinfo.port}`);
        //   return;
        // }

        const helloPacketResponse = HelloResponsePacket.from(msg);

        this._utils.debugLog(this, "Hello Packet Response:", helloPacketResponse);


        const elapsedMs = Math.ceil(Number(process.hrtime.bigint() - startNs) / 1e6);  // Convert to milliseconds
        results.push({
          response_time: elapsedMs, // ms
          response_packet: helloPacketResponse.packet,
          response_error: helloPacketResponse.header.errorCode === 0 ? null : helloPacketResponse.header.errorCode,

          // Device IP address
          ipAddress: rinfo.address,
          ipAddressValid: helloPacketResponse.payload.deviceIP === rinfo.address,

          // Device MAC address
          macAddress: helloPacketResponse.deviceMacAddress,
          macAddressRaw: helloPacketResponse.deviceMacAddressRaw,
          macAddressLegacy: this._utils.arrToHex(msg.slice(0x3a, 0x3a + 6)),

          // Device Info
          devtype: helloPacketResponse.payload.deviceType,
          devid: helloPacketResponse.payload.deviceId,
          devname: helloPacketResponse.payload.deviceName,
          devlocked: helloPacketResponse.deviceIsLocked,
        });


        // Resolve immediately if targeting a specific device (no broadcast)
        if (!isBroadcast) {
          clearTimeout(tm);
          sock.close();
          resolve(results);
        }
      });

      sock.on("error", (err) => {
        clearTimeout(tm);
        sock.close();
        reject(err);
      });

      const tm = setTimeout(() => {
        sock.close();
        if (results.length === 0) {
          reject(new Error(this.homey.__("errors.sending timeout")));
        } else {
          resolve(results);
        }
      }, timeout);
    });
  }

  /**
   * Smart discovery of devices, with optional filtering on MAC address and/or IP address.
   * If no filters are given, this will return all discovered devices within the timeout period.
   * @param {number} timeout Timeout (or scan-time) in milliseconds ( during tests: 20 - 110 ms )
   * @param {string|null} mac_adress MAC address filter, in special format (bug?)
   * @returns {Promise<Array>} Array of discovered devices matching the filters
   */
  async smart_discover(timeout = 1000, mac_adress = null) {
    this._utils.debugLog(this, `>>> Starting smart discovery with timeout ${timeout} ms, MAC address filter: ${mac_adress} <<<`);
    const localIp = await this._utils.getHomeyIpWithoutPort();

    if (!localIp) 
      throw new Error(this.homey.__("errors.discover_local_ip"));

    // If a MAC address filter is provided, perform discovery and filter results by MAC address
    if (mac_adress) {
      const discovered = await this.discover(timeout, localIp, null);
      return discovered.filter((info) => info.macAddressLegacy === this._utils.arrToHex(this._utils.hexToBuffer(mac_adress)));
    }

    return await this.discover(timeout, localIp, null);
  }

  /**
   * Get the firmware and profile version of the device. This can be used to determine the device type and capabilities.
   * @returns {Promise<{ firmwareVersion: number, profileVersion: number }>} Object containing firmwareVersion and profileVersion
   * @throws {Error} If there is an error retrieving the firmware version
   */
  async get_firmware_version() {
    var payload = new Uint8Array([0x68]);
    let response = await this.send_packet(0x6a, false, payload);
    if (response.error == 0) {
      const firmwareVersion = response.payload[0x00] | (response.payload[0x01] << 8);
      const profileVersion  = response.payload[0x0c] | (response.payload[0x0d] << 8);
      return { firmwareVersion, profileVersion };
    } else {
      throw new Error(this.homey.__("errors.get_firmware_version"));
    }
  }



  /**
   * Set device in learning mode.
   * After this, user can press a button on an IR remote.
   * Then, use check_IR_data() to read the sampled-data.
   */
  async enter_learning() {
    this._utils.debugLog(this, ">> Entering IR learning (default) <<");
    var payload = new Uint8Array(16);
    payload[0] = 3;
    await this.send_packet(0x6a, false, payload); // command 0x6a = Send, version = false
  }

  async enter_learning_red() {
    this._utils.debugLog(this, ">> IR learning, Red Bean or RM4 Mini and Pro <<");
    var payload = new Uint8Array(16);
    payload[0] = 4;
    payload[1] = 0;
    payload[2] = 3;
    await this.send_packet(0x6a, false, payload);
  }

  /**
   *
   */
  async _check_data(payload) {
    const maxAttempts = 15; // ~30s window: enough time to grab a remote and press
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      this._utils.debugLog(this, `_check_data - attempt ${attempt}/${maxAttempts}`);

      // send_packet does not throw on a socket timeout (it returns error -1),
      // so a lost poll simply falls through to the next attempt. Single
      // attempt per poll: this loop is the retry, and the device goes silent
      // while it is busy capturing
      const response = await this.send_packet(0x6a, false, payload, false, 1);
      if (response && response.error === 0) {
        this._utils.debugLog(this, "**> _check_data resp = " + this._utils.asHex(response.payload));
        return response.payload;
      }
      if (response && response.error === 0xfffb) {
        this._utils.debugLog(this, "_check_data - no data captured yet (0xfffb)");
      }
    }
    throw new Error("tried long enough");
  }

  // used for RM3 and RM3 Red bean only at this moment
  async check_IR_data() {
    var payload;
    if (this.deviceType == 0x5f36) {
      // RM Mini 3 Red Bean device type
      payload = new Uint8Array(16);
      payload[1] = 0;
      payload[2] = 4;
      this._utils.debugLog(this, `Modified payload, device RM3 Red Bean 0x5f36: `, this.deviceType);
    } else {
      this._utils.debugLog(this, `Classic RM3 legacy device (0x4):`, this.deviceType);
      payload = new Uint8Array(16);
      payload[0] = 4;
    }
    return await this._check_data(payload);
  }

  async check_IR_data_red() {
    this._utils.debugLog(this, `Modified payload, device Red Bean or RM4 (0x4,0x0,0x4): `, this.deviceType);
    var payload = new Uint8Array(16);
    payload[0] = 4;
    payload[1] = 0;
    payload[2] = 4; // Adjust the payload values as needed for RM4 Mini

    const response = await this._check_data(payload);

    // Adjust response data for RM4 devices by removing the first 2 bytes
    const adjustedResponse = response.slice(2);
    this._utils.debugLog(this, `Adjusted response data: ${this._utils.asHex(adjustedResponse)}`);

    return adjustedResponse;
  }

  /**
   * Check the sampled IR data for RM4 Mini devices, which have a different payload structure.
   * @param {boolean} trimmed - If true, returns the response data without the first 2 bytes (specific to RM4 Mini). Default is false.
   * @returns {Uint8Array} response data
   */
  async check_IR_data_rm4mini(trimmed = false) {
    this._utils.debugLog(this, `Device RM4 Mini (0x4,0x0,0x4): `, this.deviceType);
    var payload = new Uint8Array(16);
    payload[0] = 4;
    payload[1] = 0;
    payload[2] = 4; // Adjust the payload values as needed for RM4 Mini
    const response = await this._check_data(payload);
    if (trimmed) {
      const data = response.subarray(2);
      // Cap at the packet's own length field ([type][repeat][len LE][pulses]);
      // anything beyond 4 + len is AES block padding
      const pulseLen = data.length >= 4 ? data[2] | (data[3] << 8) : 0;
      if (pulseLen > 0 && 4 + pulseLen <= data.length) {
        return data.subarray(0, 4 + pulseLen);
      }
      return data;
    }
    return response;
  }

  /**
   * Method to check temperature for RM4 Pro
   */
  async checkTempHumidity_rm4pro() {
    this._utils.debugLog(this, `>>> Checking temperature and humidity <<<`);
    var payload = new Uint8Array(16);
    payload[2] = 0x24;

    try {
      var resp = await this._check_data(payload);
      this._utils.debugLog(this, `>>> Checking temp/hum data response: ` + (resp));

      // Unpack the response to get temperature
      let temperature = [resp[0x2], resp[0x3]];
      let humidity = [resp[0x4], resp[0x5]];
      this._utils.debugLog(this, `>>> Identified Temperature: ${temperature} °C <<<`);
      this._utils.debugLog(this, `>>> Identified Humidity: ${humidity} % <<<`);
      return { temperature, humidity };
    } catch (err) {
      this._utils.debugLog(this, `>>> Error checking temperature: ${err.message}`);
      throw err;
    }
  }


  /**
   *
   */
  async enterRFSweep() {
    var payload = new Uint8Array(16);
    payload[0] = 0x19;
    //was previously true but do match with
    this._utils.debugLog(this, `>>> Entering RF sweeping <<<`);
    await this.send_packet(0x6a, true, payload);
  }

  /**
   *
   */
  async checkRFData() {
    var payload = new Uint8Array(16);
    payload[0] = 0x1a;
    var retryCount = 3;
    this._utils.debugLog(this, `>>> Checking RF frequency data <<<`);
    do {
      var resp = await this._check_data(payload);
      retryCount = retryCount - 1;
    } while (retryCount > 0 && resp[0] != 1);
    if (resp[0] != 1) {
      // Log the full response for detailed inspection
      this._utils.debugLog(
        this,
        `>>> Full RF response: ${Array.from(resp)
          .map((byte) => Number(byte).toString(16).padStart(2, "0"))
          .join(", ")}`
      );
      this._utils.debugLog(this, `>>> Frequency not identified <<<`);
      throw new Error(this.homey.__("errors.no_key_detected"));
    }
  }

  /**
   *
   */
  async checkRFData2() {
    var payload = new Uint8Array(16);
    this._utils.debugLog(this, `>>> Checking RF data <<<`);
    payload[0] = 0x1b;
    return await this._check_data(payload);
  }

  /**
   *
   */
  async cancelRFSweep() {
    this._utils.debugLog(this, `>>> Stopping RF learning <<<`);
    var payload = new Uint8Array(16);
    payload[0] = 0x1e;
    await this.send_packet(0x6a, false, payload);
  }

  /**
   *
   */
  async enterRFSweep_rm4pro() {
    var payload = new Uint8Array(16);
    payload[0] = 0x04;
    payload[1] = 0x00;
    payload[2] = 0x19;
    this._utils.debugLog(this, `>>> Entering RF sweeping <<<`);

    //was previously true but do match with other implementation !!!!
    await this.send_packet(0x6a, true, payload);
  }

  /**
   *
   */
  async checkRFData_rm4pro() {
    var payload = new Uint8Array(16);
    payload[0] = 0x04;
    payload[1] = 0x00;
    payload[2] = 0x1a;
    var retryCount = 10;
    do {
      this._utils.debugLog(this, `>>> Checking RF frequency data <<< , retry : `, 11 - retryCount);
      var resp = await this._check_data(payload);
      this._utils.debugLog(this, `>>> Checking RF payload : ` + payload);
      this._utils.debugLog(this, `>>> Checking RF frequency data : ` + resp);
      retryCount = retryCount - 1;
      let frequencyBytes = resp.slice(3, 7);
      let frequency =
        (frequencyBytes[0] | (frequencyBytes[1] << 8) | (frequencyBytes[2] << 16) | (frequencyBytes[3] << 24)) / 1000.0;
      this._utils.debugLog(this, `>>> Sweeping on frequency: ${frequency} MHz <<<`);
    } while (retryCount > 0 && resp[2] != 1);

    if (resp[2] != 1) {
      // Log the full response for detailed inspection
      this._utils.debugLog(this, `>>> Frequency not identified <<<`);
      throw new Error(this.homey.__("errors.no_key_detected"));
    } else {
      // Decode frequency
      this._utils.debugLog(
        this,
        `>>> Full RF response: ${Array.from(resp)
          .map((byte) => Number(byte).toString(16).padStart(2, "0"))
          .join(", ")}`
      );
      let frequencyBytes = resp.slice(3, 7);
      let frequency =
        (frequencyBytes[0] | (frequencyBytes[1] << 8) | (frequencyBytes[2] << 16) | (frequencyBytes[3] << 24)) / 1000.0;
      this._utils.debugLog(this, `>>> Identified Final Frequency: ${frequency} MHz, bytes ${frequencyBytes}  <<<`);
      return frequencyBytes; // Return frequencyBytes directly
    }
  }


  async checkRFData2_rm4pro(frequencyBytes) {
    this._utils.debugLog(this, `checkRFData2_rm4pro with frequencyBytes: ${this._utils.arrToHex(frequencyBytes)}`);

    let payload = new Uint8Array(10);
    payload.set([0x04, 0x00, 0x1b], 0);
    payload.set(frequencyBytes, 6);

    let retryCount = 10;

    do {
      this._utils.debugLog(this, `>>> Sending packet to check captured RF data, retry: ${10 - retryCount} <<<`);
      await this._check_data(payload);

      payload.set([0x04, 0x00, 0x04], 0);

      let response = await this._check_data(payload);
      this._utils.debugLog(
        this,
        `>>> Full RF response: ${Array.from(response)
          .map((byte) => Number(byte).toString(16).padStart(2, "0"))
          .join(", ")}`);

      if (response[0] !== 0 || response[1] !== 0 || response[2] !== 0 || response[3] !== 0) {
        this._utils.debugLog(this, `>>> RF data captured successfully <<< ${this._utils.arrToHex(response.slice(2))}`);
        return response.slice(2);
      }

      retryCount--;
    } while (retryCount > 0);

    this._utils.debugLog(this, `>>> Failed to capture RF data <<<`);
    throw new Error(this.homey.__("errors.no_rf_data"));
  }


  /**
   *
   
  async checkRFData2_rm4pro(frequencyBytes) {
    this._utils.debugLog(this, `checkRFData2_rm4pro with frequencyBytes: ${this._utils.arrToHex(frequencyBytes)}`);

    let payload = new Uint8Array(10);
    payload[0] = 0x04;
    payload[1] = 0x00;
    payload[2] = 0x1b;
    payload[6] = frequencyBytes[0];
    payload[7] = frequencyBytes[1];
    payload[8] = frequencyBytes[2];
    payload[9] = frequencyBytes[3];

    let retryCount = 10;
    do {
        this._utils.debugLog(this, `>>> Sending packet to check captured RF data, retry: ${10 - retryCount} <<<`);
        await this._check_data(payload);
        //this._utils.debugLog(this, `>>> Received response: ${this._utils.arrToHex(resp)} <<<`);
        payload[0] = 0x04;
        payload[1] = 0x00;
        payload[2] = 0x04;
     //   payload[6] = frequencyBytes[0];
       // payload[7] = frequencyBytes[1];
        //payload[8] = frequencyBytes[2];
        //payload[9] = frequencyBytes[3];
        let resp = await this._check_data(payload);
        this._utils.debugLog(
                    this,
          `>>> Full RF response: ${Array.from(resp)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(", ")}`);
        // find the right response !!!! 
        // find the right response !!!! 
        // find the right response !!!! 
       // if (resp[2] === 0x04) {
            this._utils.debugLog(this, `>>> RF data captured successfully <<< ${this._utils.arrToHex(resp.slice(2))}`);

            // check the slice !!!!
            // check the slice !!!!
            // check the slice !!!!
            return resp.slice(2); // Assuming the useful data starts from the 5th byte
        //}

        retryCount--;
    } while (retryCount > 0);

    this._utils.debugLog(this, `>>> Failed to capture RF data <<<`);
    throw new Error(this.homey.__("errors.no_rf_data"));
} */


  /**
   *
   */
  async cancelRFSweep_rm4pro() {
    this._utils.debugLog(this, `>>> Stopping RF learning <<<`);
    var payload = new Uint8Array(16);
    payload[0] = 0x04;
    payload[1] = 0x00;
    payload[2] = 0x1e;
    await this.send_packet(0x6a, true, payload);
  }

  /**
   * Send a command to the device. The command was previously retrieved
   * with check_IR_data()
   */
  async send_IR_RF_data(data) {
    var payload;
    if (this.deviceType == 0x5f36) {
      // RM Mini 3 Red Bean device type
      payload = new Uint8Array(4);
      payload[0] = 0xd0;
      payload[1] = 0x00;
      payload[2] = 0x02;
      this._utils.debugLog(this, `Sent device Red Bean :`, this.deviceType);
    } else {
      payload = new Uint8Array(4);
      payload[0] = 0x02;
    }
    payload = this._utils.concatTypedArrays(payload, data);
    this._utils.debugLog(this, `Sent standard RM3 :`, this.deviceType);
    await this.send_packet(0x6a, false, payload);
  }

  async send_IR_RF_data_red(data) {
    var payload = new Uint8Array(4);
    payload[0] = 0xd0;
    payload[1] = 0x00;
    payload[2] = 0x02;
    payload = this._utils.concatTypedArrays(payload, data);
    this._utils.debugLog(this, `Sent device Red Bean/RM4 :`, this.deviceType);
    await this.send_packet(0x6a, false, payload);
  }

  async send_IR_RF_data_minired(data) {
    var payload = new Uint8Array(6); // Increase the size to 6 bytes
    payload[0] = 0xd0;
    payload[1] = 0x00;
    payload[2] = 0x02;
    payload[3] = 0x00; // Add missing bytes
    payload[4] = 0x00;
    payload[5] = 0x00;
    payload = this._utils.concatTypedArrays(payload, data);
    this._utils.debugLog(this, `Sent IR/RF data (new protocol, 6-byte header), deviceType 0x${this.deviceType.toString(16)}`);
    await this.send_packet(0x6a, false, payload);
  }
  async send_IR_RF_data_rm4pro(data) {
    var payload = new Uint8Array(6);
    // ??? modified based on "this.code_sending_header = this.rm4Type ? new Buffer([0xda, 0x00]) : new Buffer([]);" - https://github.com/kiwi-cam/broadlinkjs-rm/blob/3b4793c8bece65b8421fab4595f70c64adef3211/index.js#L271
    // previously it was payload[0] = 0xd0; ???
    payload[0] = 0xda;
    payload[1] = 0x00;
    payload[2] = 0x02;
    payload[3] = 0x00;
    payload[4] = 0x00;
    payload[5] = 0x00;
    payload = this._utils.concatTypedArrays(payload, data);
    this._utils.debugLog(this, `Sent device RM4 Pro :`, this.deviceType);
    await this.send_packet(0x6a, false, payload);
  }
  /**
   *
   */
  async read_status() {
    var payload = new Uint8Array(16);
    payload[0] = 0x01;
    let response = await this.send_packet(0x6a, false, payload);

    if (response.error == 0) {
      return response.payload;
    } else {
      throw new Error(this.homey.__("errors.invalid_response"));
    }
  }

  /**
   * Sets the night light state of the smart plug
   * @param {byte} state   [0,1,2,3]
   */
  async setPowerState(state) {
    var payload = new Uint8Array(16);
    payload[0] = 0x02;
    payload[4] = state;
    await this.send_packet(0x6a, false, payload);
  }

  /**
   * SP2 and SP3S
   */
  async sp2_get_energy() {
    var payload = new Uint8Array([8, 0, 254, 1, 5, 1, 0, 0, 0, 45]);
    let response = await this.send_packet(0x6a, false, payload);
    if (response.error == 0) {
      return response.payload;
    }
    throw new Error(this.homey.__("errors.invalid_response"));
  }

  /**
   * Returns the power state of the smart power strip in raw format.
   */
  async mp1_check_power() {
    var payload = new Uint8Array(16);
    payload[0x00] = 0x0a;
    payload[0x02] = 0xa5;
    payload[0x03] = 0xa5;
    payload[0x04] = 0x5a;
    payload[0x05] = 0x5a;
    payload[0x06] = 0xae;
    payload[0x07] = 0xc0;
    payload[0x08] = 0x01;

    let response = await this.send_packet(0x6a, false, payload);
    if (response.error == 0) {
      return response.payload[0x0a];
    }
    throw new Error(this.homey.__("errors.invalid_response"));
  }

  /**
   * @param  sid  [integer or string]  1..4
   * @param  mode [boolean]  true = on, false = off
   */
  async mp1_set_power_state(sid, mode) {
    sid = Number(sid);
    if (!Number.isInteger(sid) || sid < 1 || sid > 4) {
      throw new Error(`Invalid socket id: ${sid} (expected 1-4)`);
    }
    let sid_mask = 0x01 << (sid - 1);

    var payload = new Uint8Array(16);
    payload[0x00] = 0x0d;
    payload[0x02] = 0xa5;
    payload[0x03] = 0xa5;
    payload[0x04] = 0x5a;
    payload[0x05] = 0x5a;
    payload[0x06] = 0xb2 + (mode ? sid_mask << 1 : sid_mask);
    payload[0x07] = 0xc0;
    payload[0x08] = 0x02;
    payload[0x0a] = 0x03;
    payload[0x0d] = sid_mask;
    payload[0x0e] = mode ? sid_mask : 0;

    try {
      let resp = await this.send_packet(0x6a, false, payload);
      if (resp.error != 0) {
        throw new Error(this.homey.__("errors.invalid_response"));
      }
    } catch (err) {
      throw new Error(this.homey.__("errors.invalid_response"));
    }
  }

  /**
   *
   */
  async sp1_set_power_state(mode) {
    var payload = new Uint8Array(4);
    payload[0] = mode ? 0x01 : 0x00;
    payload[1] = 0x04;
    payload[2] = 0x04;
    payload[3] = 0x04;

    try {
      await this.send_packet(0x66, false, payload);
    } catch (err) {
      //throw new Error(this.homey.__('errors.invalid_response'))
    }
  }

  /**
   *
   */
  async dooya_set_state(cmd1, cmd2) {
    var payload = new Uint8Array(16);
    payload[0] = 0x09;
    payload[2] = 0xbb;
    payload[3] = cmd1;
    payload[4] = cmd2;
    payload[9] = 0xfa;
    payload[10] = 0x44;
    let response = await this.send_packet(0x6a, false, payload);

    if (response.error == 0) {
      if (response.payload.length > 0) {
        return response.payload[0];
      }
    }
    throw new Error(this.homey.__("errors.invalid_response"));
  }
}

module.exports = Communicate;
