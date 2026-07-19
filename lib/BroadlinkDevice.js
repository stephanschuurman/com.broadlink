/**
 * Driver for Broadlink devices
 *
 * Copyright 2018-2019, R Wensveen
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
//const fs = require("fs");

class BroadlinkDevice extends Homey.Device {
  constructor(...props) {
    super(...props);
    this._utils = new BroadlinkUtils(this.homey);
    this._isDeleted = false;
  }

  /**
   * This method is called when the device is loaded, and properties such as name,
   * capabilities and state are available.
   * However, the device may or may not have been added yet.
   */
  async onInit(dev) {
    this._isDeleted = false;
    let deviceSettings = this.getSettings();
    let deviceData = this.getData();
    const deviceMac = deviceData.mac || deviceData.id;
    // Devices paired before this setting existed have no value: treat as automatic
    const ipMode = deviceSettings.ip_assignment_mode || "automatic";

    let options = {
      ipAddress: deviceSettings.ip_assignment_mode === "manual" ? deviceSettings.ipAddress : null,
      mac: this._utils.hexToArr(deviceMac),
      count: Math.floor(Math.random() * 0xffff),
      id: this._utils.hexToArr(deviceSettings.id),
      key: this._utils.hexToArr(deviceSettings.key),
      homey: this.homey,
      deviceType: parseInt(deviceData.devtype, 10),
    };

    this._communicate = new Communicate();
    this._communicate.configure(options);

    // Store static device info in settings (type from pairing data, as decimal)
    this.setSettings({
      device_type: String(parseInt(deviceData.devtype, 10)),
    }).catch(() => {});
    this._communicate.onAuthSuccess = (id, key) => {
      this._utils.debugLog(this, 'Auto re-auth succeeded, saving new key/id to settings');
      this.setSettings({
        key: this._utils.arrToHex(key),
        id: this._utils.arrToHex(id),
      }).catch((err) => this._utils.debugLog(this, 'Failed to save re-auth settings: ' + err));
    };


    // TODO try {}
    if (ipMode === "automatic") {
      this.reDiscoverIpAddress()
        .then(() => this._fetchAndStoreFirmwareVersion())
        .catch((err) => {
          this._utils.debugLog(this, "Error during IP discovery: " + err);
          if (!this._isDeleted) {
            this.setWarning(this.homey.__("errors.discovery_failed") + ": " + err.message).catch(this.error);
          }
          if (this._communicate) {
            if (deviceSettings.ipAddress) {
              this._communicate.setIPaddress(deviceSettings.ipAddress);
              this._fetchAndStoreFirmwareVersion();
            }
          }
        });
    } else {
      this._utils.debugLog(this, "IP assignment mode is manual, skipping discovery");
      this._fetchAndStoreFirmwareVersion();
    }

    // Extract and log only the required information
    let logData = {
      ipAddress: options.ipAddress,
      mac: this._utils.arrToHex(options.mac),
      key: options.key ? `[redacted, ${options.key.length} bytes]` : null,
      deviceType: `0x${parseInt(deviceData.devtype, 10).toString(16)}`, // Convert to hexadecimal format
      deviceName: this.getName(),
      typeName: deviceData.typeName,
    };

    this._utils.debugLog(this, "onInit - logData:", logData);
    //this._utils.debugLog(this, `_communicate object keys: ${Object.keys(this._communicate)}`);

    // Start periodic IP rediscovery if discovery_interval is configured;
    // manual mode keeps the user's fixed IP, so no rediscovery there
    if (deviceSettings.discovery_interval && ipMode === "automatic")
      this.start_ip_rediscovery_timer(deviceSettings.discovery_interval);
  }

  onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.length > 0) {
      this._utils.debugLog(this, 'Settings changed:', changedKeys);
      this._utils.debugLog(this, 'Old settings:', oldSettings);
      this._utils.debugLog(this, 'New settings:', newSettings);

      changedKeys.forEach(key => {
        this._utils.debugLog(this, `Changed setting key: ${key}, Old value: ${oldSettings[key]}, New value: ${newSettings[key]}`);

        if (key === "discovery_interval" || key === "ip_assignment_mode") {
          this.stop_ip_rediscovery_timer();
          if (newSettings.discovery_interval && (newSettings.ip_assignment_mode || "automatic") === "automatic") {
            this.start_ip_rediscovery_timer(newSettings.discovery_interval);
          }
        }
      });
    }
  }

  /**
   * Discover the IP address of the device by sending a discovery packet and waiting for a response.
   * @param {number} timeout in miliseconds to wait for discovery responses (default: 3000ms)
   */
  async reDiscoverIpAddress(timeout = 3000) {
    if (this._isDeleted || !this._communicate || typeof this._communicate.discover !== "function") {
      this._utils.debugLog(this, "Skipping IP discovery because communicator is not available");
      return;
    }


    const deviceSettings = this.getSettings();
    const deviceData = this.getData();
    const localHomeyIpAddress = await this._utils.getHomeyIpWithoutPort();
    const storedMacAddress = this._utils.hexToBuffer(deviceData.mac || deviceData.id); // Check both?

    try {
      const knownIp = deviceSettings.ipAddress;
      // Devices paired before this setting existed have no value: treat as automatic
      const ipMode = deviceSettings.ip_assignment_mode || "automatic";
      let matchingDevice = null;

      // Unicast first: works where broadcasts are blocked (Docker during
      // `homey app run`, VLAN/AP isolation) and confirms the device is still
      // on its known address
      if (knownIp) {
        this._utils.debugLog(this, `Starting IP discovery (unicast to ${knownIp}) for MAC: ${this._utils.bufferToMacReadable(storedMacAddress)}, timeout: ${timeout}ms`);
        matchingDevice = await this._discoverAndMatch(timeout, localHomeyIpAddress, knownIp, storedMacAddress);
      }

      // Broadcast as fallback: finds the device again when DHCP moved it to a new address
      if (!matchingDevice) {
        this._utils.debugLog(this, `Starting IP discovery (broadcast) for MAC: ${this._utils.bufferToMacReadable(storedMacAddress)}, from: ${localHomeyIpAddress}, timeout: ${timeout}ms`);
        matchingDevice = await this._discoverAndMatch(timeout, localHomeyIpAddress, null, storedMacAddress);
      }

      if (!matchingDevice) {
        throw new Error("Device not found during discovery");
      }

      this._utils.debugLog(this, "Device discovered with IP: " + matchingDevice.ipAddress);
      
      // Update IP in settings (automatic mode), devlocked, devid and devname from discovery
      const settingsUpdate = {
        devlocked: matchingDevice.devlocked ? this.homey.__("common.yes") : this.homey.__("common.no"),
        device_id: String(matchingDevice.devid ?? ""),
        devname: String(matchingDevice.devname ?? ""),
        mac_address: matchingDevice.macAddress ?? matchingDevice.macAddressLegacy ?? "",
      };
      if (ipMode === "automatic")
        settingsUpdate.ipAddress = matchingDevice.ipAddress;
      try {
        await this.setSettings(settingsUpdate);
      } catch (settingsErr) {
        // Some of these settings may not exist in older driver manifests;
        // failing to store them must not fail the discovery itself
        this._utils.debugLog(this, "Discovery settings update skipped: " + settingsErr);
      }

      // Check is authenticated
      if (matchingDevice.requiresAuthentication) {
        this._utils.debugLog(this, "Device requires authentication, setting warning");
        await this.setWarning(this.homey.__("errors.authentication_required"));
      } else if (matchingDevice.devlocked) {
        this._utils.debugLog(this, "Device is locked, setting warning");
        await this.setWarning(this.homey.__("pair.error_device_locked"));
      } else {
        await this.setWarning(null); // Clear any existing warnings
      }



      // Apply the discovered IP only in automatic mode (configure() starts with
      // 255.255.255.255 there); manual mode keeps the user's configured IP
      if (ipMode === "automatic" && this._communicate)
        this._communicate.setIPaddress(matchingDevice.ipAddress);

    } catch (err) {
      // No log here: the caller in onInit logs the failure once
      const discoveryFailedMessage = this.homey.__("errors.discovery_failed") || "Discovery failed";
      throw new Error(discoveryFailedMessage + ": " + err.message);
    }
  }

  /**
   * Run one discovery round (unicast when targetIp is given, broadcast
   * otherwise) and return the response matching this device's MAC, or null
   * when nothing (matching) responded.
   */
  async _discoverAndMatch(timeout, localIp, targetIp, storedMacAddress) {
    try {
      const found = await this._communicate.discover(timeout, localIp, targetIp);
      const targetMac = this._utils.arrToHex(storedMacAddress);
      const match = found.find((device) => device.macAddressLegacy === targetMac);
      if (!match && found.length > 0) {
        this._utils.debugLog(this, `Discovery got ${found.length} response(s), none matching MAC ${this._utils.bufferToMacReadable(storedMacAddress)}`);
      }
      return match || null;
    } catch (err) {
      this._utils.debugLog(this, `Discovery ${targetIp ? `(unicast to ${targetIp})` : "(broadcast)"} got no response`);
      return null;
    }
  }

    //   if (infos.length > 0) {
    //     const info = infos.find(info => info.mac === deviceData.mac);
    //     if (!info) {
    //       this._utils.debugLog(this, "Device not found during discovery, using settings IP address if available");
    //       if (deviceSettings.ipAddress) {
    //         this._utils.debugLog(this, "Using IP address from settings: " + deviceSettings.ipAddress);
    //         this._communicate.setIPaddress(deviceSettings.ipAddress);
    //       } else {
    //         this._utils.debugLog(this, "No IP address available in settings, device may not function correctly");
    //         await this.setWarning(this.homey.__("errors.discovery_failed_no_ip"));
    //       }
    //       return;
    //     }
 
    //     this._utils.debugLog(this, "Device discovered during onInit with IP: " + info.ipAddress);
    //     await this.setSettings({ ipAddress: info.ipAddress });
    //   } else {
    //     this._utils.debugLog(this, "No device discovered during onInit");
    //     // Optionally, you could set a warning here to inform the user that discovery failed
    //     await this.setWarning(this.homey.__("errors.discovery_failed"));
    //     // If discovery fails, use settings IP address if available, otherwise log an error
    //     if (deviceSettings.ipAddress) {
    //       this._utils.debugLog(this, "Using IP address from settings: " + deviceSettings.ipAddress);
    //       this._communicate.setIPaddress(deviceSettings.ipAddress);
    //     }
    //   }
    // }


  /**
   *
   */
  async authenticateDevice() {
    try {
      const authenticationData = await this._communicate.auth();
      const newSettings = {
        key: this._utils.arrToHex(authenticationData.key),
        id: this._utils.arrToHex(authenticationData.id),
      };

      // Use setTimeout with a delay of 0 to defer the settings update
      this.settingsTimeout = setTimeout(async () => {
        try {
          await this.setSettings(newSettings);
          await this.setSettings({ Authenticate: false });
        } catch (err) {
          this._utils.debugLog(this, "**> setSettings error: " + err);
        }
      }, 100); // Delay of 0 milliseconds to ensure asynchronous execution
    } catch (err) {
      this._utils.debugLog(this, "**> authentication error: " + err);
      throw err;
    }
  }

  /**
   * This method is called when the user adds the device, called just after pairing.
   *
   * Which means, the device has been discovered (it has an ipAddress, MAC). Now we
   * can authenticate it to get is 'key' and 'id'
   */
  onAdded() {


        
    let deviceData = this.getData();
    let options = {
      ipAddress: this.getSettings().ipAddress,
      mac: this._utils.hexToArr(deviceData.mac),
      count: Math.floor(Math.random() * 0xffff),
      id: null,
      key: null,
      homey: this.homey,
      deviceType: parseInt(deviceData.devtype, 10),
    };

    this._communicate.configure(options);

    this.authenticateDevice()
      .then(() => this._fetchAndStoreFirmwareVersion())
      .catch((err) => {
        this.setWarning(this.homey.__("errors.authentication_failed") + ": " + err.message).catch(this.error);
      });
  }

  async _fetchAndStoreFirmwareVersion() {
    try {
      const { firmwareVersion, profileVersion } = await this._communicate.get_firmware_version();
      this._utils.debugLog(this, `Device firmware version: ${firmwareVersion}, profile version: ${profileVersion}`);
      await this.setSettings({ firmware_version: String(firmwareVersion), profile_version: String(profileVersion) });
    } catch (err) {
      this._utils.debugLog(this, `Failed to get firmware version: ${err.message}`);
    }
  }

  /**
   * This method will be called when a device has been removed.
   */
  onDeleted() {
    this._isDeleted = true;
    this.stop_ip_rediscovery_timer();
    this.stop_check_interval();
    this._utils.debugLog(this, 'Device deleted');
    if (this.settingsTimeout) {
      clearTimeout(this.settingsTimeout);
      this.settingsTimeout = null;
    }
    if (this._communicate) {
      this._communicate.destroy();
    }
    this._communicate = null;
  }

  /** */
  /**
   * Called when the device settings are changed by the user
   * (so NOT called on programmatically changing settings)
   *
   *  @param changedKeysArr   contains an array of keys that have been changed
   */
  /** async onSettings({ oldSettings, newSettings, changedKeys }) {
		if (changedKeys.length > 0) {

			try {
				this._utils.debugLog(this, 'Settings changed:', changedKeys);
				this._utils.debugLog(this, 'Old settings:', oldSettings);
				this._utils.debugLog(this, 'New settings:', newSettings);

				changedKeys.forEach(key => {
					this._utils.debugLog(this, `Changed setting key: ${key}, Old value: ${oldSettings[key]}, New value: ${newSettings[key]}`);

					if (key === 'ipAddress' && newSettings.ipAddress) {
						this._utils.debugLog(this, `Updating IP address to ${newSettings.ipAddress}`);
						this._communicate.setIPaddress(newSettings.ipAddress);
					}
					if (key === 'CheckInterval' && newSettings.CheckInterval) {
						this._utils.debugLog(this, `Updating CheckInterval to ${newSettings.CheckInterval}`);
						this.stop_check_interval();
						this.start_check_interval(newSettings.CheckInterval);
					}
					if (key === 'Authenticate') {
						this._utils.debugLog(this, 'Re-authenticating device');
						this.authenticateDevice();
					}
				});
			} catch (err) {
				this._utils.debugLog(this, 'Error handling settings change: ', err);
				throw new Error('Settings could not be updated: ' + err.message);
			}
			this.log('Broadlink settings changed:\n', changedKeys);
		}
		else {
			this.log('No settings were changed');

		}
	}
 */

  /**
   * Start periodic network discovery to keep the device IP up to date.
   * @param {number} interval in minutes between rediscovery attempts
   */
  start_ip_rediscovery_timer(interval) {
    const intervalMinutes = Number(interval);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      this._utils.debugLog(this, `Invalid discovery_interval value: ${interval}`);
      return;
    }

    this.stop_ip_rediscovery_timer();

    this.ipRediscoveryTimer = setInterval(
      function () {
        try {
          if (this._isDeleted || !this._communicate || typeof this._communicate.discover !== "function") {
            this.stop_ip_rediscovery_timer();
            return;
          }

          this._utils.debugLog(this, "Periodic check interval triggered, re-discovering IP address");
          this.reDiscoverIpAddress().catch((err) => {
            this._utils.debugLog(this, "Error during periodic IP discovery: " + err);
            if (!this._isDeleted) {
              // Optionally set a warning to inform the user that discovery failed
              this.setWarning(this.homey.__("errors.discovery_failed") + ": " + err.message).catch(this.error);
            }
          });
        } catch (err) {
          this._utils.debugLog(this, "Error during periodic check interval: " + err);
          if (!this._isDeleted) {
            // Optionally set a warning to inform the user that the check failed
            this.setWarning(this.homey.__("errors.check_interval_failed") + ": " + err.message).catch(this.error);
          }
        }
      }.bind(this),
      intervalMinutes * 60 * 1000
    ); // [minutes] to [msec]
  }

  /**
   * Stop the periodic IP rediscovery timer
   */
  stop_ip_rediscovery_timer() {
    if (this.ipRediscoveryTimer) {
      clearInterval(this.ipRediscoveryTimer);
      this.ipRediscoveryTimer = null;
    }
  }

  /**
   * Start a timer to periodically access the device. 
   * @param {number} interval in minutes to wait between checks
   */
  start_check_interval(interval) {
    this.checkTimer = setInterval(
      function () {
        if (typeof this.onCheckInterval === "function") {
          Promise.resolve(this.onCheckInterval()).catch((err) => {
            this._utils.debugLog(this, "Error in onCheckInterval: " + err);
          });
        }
      }.bind(this),
      interval * 60000
    ); // [minutes] to [msec]
  }

  /**
   * Stop the periodic timer
   */
  stop_check_interval() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

module.exports = BroadlinkDevice;
