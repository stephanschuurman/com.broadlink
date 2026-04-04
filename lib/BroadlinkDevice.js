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

    let options = {
      ipAddress: deviceSettings.ip_assignment_mode === "manual" ? deviceSettings.ipAddress : null,
      mac: this._utils.hexToArr(deviceMac),
      count: Math.floor(Math.random() * 0xffff),
      id: this._utils.hexToArr(deviceSettings.id),
      key: this._utils.hexToArr(deviceSettings.key),
      homey: this.homey,
      deviceType: `0x${parseInt(deviceData.devtype, 10).toString(16)}`, // Convert to hexadecimal format
    };

    this._communicate = new Communicate();
    this._communicate.configure(options);

    // TODO try {}
    if (deviceSettings.ip_assignment_mode === "automatic") {
      this.reDiscoverIpAddress().catch((err) => {
        this._utils.debugLog(this, "Error during IP discovery: " + err);
        if (!this._isDeleted) {
          // Optionally set a warning to inform the user that discovery failed
          this.setWarning(this.homey.__("errors.discovery_failed") + ": " + err.message).catch(this.error);
        }
        if (this._communicate) {
          this._communicate.setIPaddress(deviceSettings.ipAddress);
        }
      });
    } else {
      this._utils.debugLog(this, "IP assignment mode is manual, skipping discovery");
    }

    // Extract and log only the required information
    let logData = {
      ipAddress: options.ipAddress,
      mac: this._utils.arrToHex(options.mac),
      key: this._utils.arrToHex(options.key),
      deviceType: `0x${parseInt(deviceData.devtype, 10).toString(16)}`, // Convert to hexadecimal format
      deviceName: this.getName(),
      typeName: deviceData.typeName,
    };

    this._utils.debugLog(this, "onInit - logData:", logData);
    //this._utils.debugLog(this, `_communicate object keys: ${Object.keys(this._communicate)}`);

    // Start periodic IP rediscovery if discovery_interval is configured (seconds)
    if (deviceSettings.discovery_interval)
      this.start_ip_rediscovery_timer(deviceSettings.discovery_interval);
  }

  onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.length > 0) {
      this._utils.debugLog(this, 'Settings changed:', changedKeys);
      this._utils.debugLog(this, 'Old settings:', oldSettings);
      this._utils.debugLog(this, 'New settings:', newSettings);

      changedKeys.forEach(key => {
        this._utils.debugLog(this, `Changed setting key: ${key}, Old value: ${oldSettings[key]}, New value: ${newSettings[key]}`);

        if (key === "discovery_interval") {
          this.stop_ip_rediscovery_timer();
          this.start_ip_rediscovery_timer(newSettings.discovery_interval);
        }
      });
    }
  }

  /**
   * Discover the IP address of the device by sending a discovery packet and waiting for a response.
   * @param {number} timeout in miliseconds to wait for discovery responses (default: 500ms)
   */
  async reDiscoverIpAddress(timeout = 500) {
    if (this._isDeleted || !this._communicate || typeof this._communicate.discover !== "function") {
      this._utils.debugLog(this, "Skipping IP discovery because communicator is not available");
      return;
    }

    const deviceSettings = this.getSettings();
    const deviceData = this.getData();
    const localHomeyIpAddress = await this._utils.getHomeyIpWithoutPort();
    const storedMacAddress = this._utils.hexToBuffer(deviceData.mac || deviceData.id); // Check both?

    try {

      this._utils.debugLog(this, `Starting IP discovery for MAC: ${this._utils.bufferToMacReadable(storedMacAddress)}, from: ${localHomeyIpAddress}, timeout: ${timeout}ms`);

      // Discover devices on the network using the communicate module
      const broadLinkDevicesFound = await this._communicate.discover(timeout, localHomeyIpAddress, "192.168.1.194");
      if (broadLinkDevicesFound.length === 0) {
        throw new Error("No Broadlink devices found during discovery");
      }

      this._utils.debugLog(this, `Discovery completed, found ${broadLinkDevicesFound.length} device(s)`, broadLinkDevicesFound);

      // Find the device with the matching MAC address
      const matchingDevice = broadLinkDevicesFound.find((device) => {
        return (this._utils.arrToHex(device.mac) === this._utils.arrToHex(storedMacAddress));
      });

      if (!matchingDevice) {
        const foundMacs = broadLinkDevicesFound.map((device) => ({
          reversed: this._utils.bufferToMacReadable(this._utils.arrToHex(device.mac)),
        }));
        this._utils.debugLog(this, `MAC mismatch during discovery. target=${this._utils.bufferToMacReadable(this._utils.arrToHex(storedMacAddress))}`, foundMacs);
        throw new Error("Device not found during discovery");
      }

      this._utils.debugLog(this, "Device discovered with IP: " + matchingDevice.ipAddress);
      
      // If overwriteSettings is true, update the device settings with the discovered IP address
      if (deviceSettings.ip_assignment_mode === "automatic")
        await this.setSettings({ ipAddress: matchingDevice.ipAddress });

      // Update the communicate module with the discovered IP address and save it in settings
      if (this._communicate)
        this._communicate.setIPaddress(matchingDevice.ipAddress);
      
    } catch (err) {
      this._utils.debugLog(this, "Error during IP discovery: " + err);
      const discoveryFailedMessage = this.homey.__("errors.discovery_failed") || "Discovery failed";
      throw new Error(discoveryFailedMessage + ": " + err.message);
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
      deviceType: parseInt(deviceData.devtype, 16),
    };

    this._communicate.configure(options);

    this.authenticateDevice().catch((err) => {
      this.setWarning(this.homey.__("errors.authentication_failed") + ": " + err.message).catch(this.error);
    });
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
   * @param {number} interval in seconds between rediscovery attempts
   */
  start_ip_rediscovery_timer(interval) {
    const intervalSeconds = Number(interval);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
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
      intervalSeconds * 1000 * 60
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
