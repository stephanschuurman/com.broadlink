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

const Homey = require("homey");
const Communicate = require("./../lib/Communicate");
const BroadlinkUtils = require("./../lib/BroadlinkUtils.js");

class BroadlinkDriver extends Homey.Driver {
  constructor(...props) {
    super(...props);
    this._utils = new BroadlinkUtils(this.homey);
  }

  /**
   * Method that will be called when a driver is initialized.
   * @param options {Object}.CompatibilityID
   */
  onInit(options) {
    if (options) {
      this.CompatibilityID = options.CompatibilityID;
    }
    // list of devices discovered during pairing
    this.discoveredDevices = undefined;
  }

  /**
   * Set the CompatibilityID for this device
   */
  setCompatibilityID(id) {
    this.CompatibilityID = id;
  }

  /**
   * Handles the backend of the pairing sequence.
   * Communication to the frontend is done via events => socket.emit('x')
   *
   */
  async onPair(session) {
    // Initialize session-specific variables
    session.discoveredDevices = undefined;
    session._communicate = new Communicate();
    session._isConnected = true;

    const safeEmit = (event, payload) => {
      if (!session._isConnected) {
        this._utils.debugLog(this, `Pair session inactive; skip emit: ${event}`);
        return;
      }
      try {
        session.emit(event, payload);
      } catch (err) {
        this._utils.debugLog(this, `Pair session emit failed (${event}): ${err.message}`);
      }
    };
    
    // Configure communication options
    const commOptions = {
      ipAddress: null,
      mac: null,
      id: null,
      count: Math.floor(Math.random() * 0xffff),
      key: null,
      homey: this.homey,
    };
    session._communicate.configure(commOptions);

    session.setHandler('get_homey_ip', async () => {
      return await this._utils.getHomeyIpWithoutPort();
    });


    // Handle session disconnect
    session.setHandler("disconnect", async () => {
      try {
        this._utils.debugLog(this, "Pair session disconnected");
        session._isConnected = false;
        if (session._communicate) {
          session._communicate.destroy();
          session._communicate = undefined;
        }
        session.discoveredDevices = undefined;
      } catch (err) {
        this._utils.debugLog(this, `Error during disconnect: ${err.message}`);
      }
    });

    session.setHandler("start_discover", async (data) => {
      session.discoveredDevices = undefined;
      this._utils.debugLog(this, "**>onPair.start_discover: " + JSON.stringify(data));

      if (!session._isConnected) {
        this._utils.debugLog(this, "**>onPair.start_discover: session not connected");
        return;
      }
      if (!session._communicate) {
        this._utils.debugLog(this, "**>onPair.start_discover: communicate not available");
        return;
      }

      try {
        const localAddress = await this._utils.getHomeyIpWithoutPort();
        this._utils.debugLog(this, `**>onPair.localAddress: ${localAddress}, data.address: ${data.address}`);

        const timeout = data.timeout || 1000;
        const infos = await session._communicate.discover(timeout, localAddress, data.address);
        this._utils.debugLog(this, `**>onPair.resolved: ${JSON.stringify(infos)}, CompatibilityID: ${this.CompatibilityID}`);

        session.discoveredDevices = infos.map((info) => {
          const devinfo = this._utils.getDeviceInfo(info.devtype, this.CompatibilityID);
          const macRaw = Array.from(info.macAddressRaw);
          // Short label: the 3 device-unique octets (packet stores the MAC reversed), shown in readable order
          const readableMacSuffix = this._utils.asHex(macRaw.slice(0, 3).reverse(), ":");
          return {
            device: {
              name: `${devinfo.name} (…${readableMacSuffix})`,
              data: {
                name: devinfo.name,
                mac: this._utils.arrToHex(macRaw),
                mac_raw: macRaw,
                devtype: info.devtype.toString(),
              },
              settings: {
                ipAddress: info.ipAddress,
                ip_assignment_mode: data.address ? "manual" : "automatic",
              },
            },
            isCompatible: devinfo.isCompatible,
            isLocked: info.devlocked,
            typeName: info.devtype.toString(16).toUpperCase(),
          };
        });

        this._utils.debugLog(this, `**>onPair.discoveredDevices: ${JSON.stringify(session.discoveredDevices)}`);
        return session.discoveredDevices;
      } catch (err) {
        this._utils.debugLog(this, `**>onPair.error during discovery: ${err.message}`);
        return [];
      }
    });

    session.setHandler("list_devices", async () => {
      const discovered = session.discoveredDevices || [];

      if (discovered.length === 0) {
        this._utils.debugLog(this, "==>Broadlink - list_devices: No compatible device discovered");
        return [];
      }

      const devices = discovered.map((d) => ({
        name: d.device.name,
        data: {
          isCompatible: d.isCompatible,
          typeName: d.typeName,
          ...d.device.data,
          // Keep last so nothing in the spread can overwrite the device identity
          id: d.device.data.mac,
        },
        settings: d.device.settings,
      }));

      this._utils.debugLog(this, "==>Broadlink - list_devices: " + JSON.stringify(devices));
      return devices;
    });
  }

  /**
   * Handles the backend of the repair sequence for a device. 
   * @param {Homey.PairSession} session 
   * @param {Homey.Device} device 
   */
  onRepair(session, device) {
    this._utils.debugLog(this, `Starting repair for device ${device.getName()} (${device.getData().id})`);

    session._communicate = new Communicate();
    const commOptions = {
      ipAddress: null,
      mac: null,
      id: null,
      count: Math.floor(Math.random() * 0xffff),
      key: null,
      homey: this.homey,
    };
    session._communicate.configure(commOptions);

    // Provide device context to the repair UI
    session.setHandler("get_repair_context", async () => {
      return {
        name: device.getName(),
        data: device.getData(),
        settings: device.getSettings(),
      };
    });

    session.setHandler("rediscover", async (options) => {
      this._utils.debugLog(this, `Repair - rediscover called with options: ${JSON.stringify(options)}`);
      try {
        const result = await session._communicate.smart_discover(options?.timeout, device.getData().mac);
        this._utils.debugLog(this, `Repair - smart_discover results: ${JSON.stringify(result)}`);
        return result;
      } catch (err) {
        this._utils.debugLog(this, `Repair - rediscover error: ${err.message}`);
        throw err;
      }
    });

    // Handle settings patch from the repair UI
    session.setHandler("set_repair_settings", async (patch) => {
      this._utils.debugLog(this, `Repair - set_repair_settings called with data: ${JSON.stringify(patch)}`);

      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new Error("settings patch must be an object");
      }

      const allowedKeys = new Set(["ip_assignment_mode", "ipAddress"]);
      const patchKeys = Object.keys(patch);
      const unknownKeys = patchKeys.filter((k) => !allowedKeys.has(k));
      if (unknownKeys.length > 0) {
        throw new Error(`unsupported settings field(s): ${unknownKeys.join(", ")}`);
      }

      const updates = {};

      if (Object.prototype.hasOwnProperty.call(patch, "ip_assignment_mode")) {
        const mode = patch.ip_assignment_mode;
        if (mode !== "automatic" && mode !== "manual") {
          throw new Error('ip_assignment_mode must be "automatic" or "manual"');
        }
        updates.ip_assignment_mode = mode;
      }

      if (Object.prototype.hasOwnProperty.call(patch, "ipAddress")) {
        const ipAddress = String(patch.ipAddress || "").trim();
        const isValidIPv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ipAddress);
        if (!isValidIPv4) {
          throw new Error("ipAddress must be a valid IPv4 address");
        }
        updates.ipAddress = ipAddress;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("no supported settings provided");
      }

      if (updates.ip_assignment_mode === "manual" && !updates.ipAddress) {
        const currentIp = String(device.getSettings().ipAddress || "").trim();
        const hasValidCurrentIp = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(currentIp);
        if (!hasValidCurrentIp) {
          throw new Error("manual mode requires a valid ipAddress");
        }
      }

      await device.setSettings(updates);
      return {
        ok: true,
        updated: updates,
        settings: device.getSettings(),
      };
    });

    session.setHandler("disconnect", () => {
      this._utils.debugLog(this, `Repair session for device ${device.getName()} disconnected`);
      if (session._communicate) {
        session._communicate.destroy();
        session._communicate = undefined;
      }
    });
  }


}

module.exports = BroadlinkDriver;
